"""The AI service: agents, RAG and moderation behind a small HTTP API. Internal only: the Node web tier is the one
public entry point and calls this with a shared secret.

    python -m uvicorn ai_service.main:app --port 8100
"""
import hmac
import json
import logging
import os
import re
import uuid
from contextlib import asynccontextmanager
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.openapi.utils import get_openapi
from fastapi.responses import FileResponse, StreamingResponse

from ai_service.runtime import FAILURE_MESSAGE, Busy, ChatRunner
from ai_service.schemas import ChatRequest, ChatResponse, ErrorEvent, HealthResponse, StepEvent

log = logging.getLogger("ai_service")

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
EVIDENCE_DIR = os.path.join(ROOT, "tests_qa", "evidence")
_EVIDENCE_NAME = re.compile(r"^[A-Za-z0-9_.-]+\.png$")

SSE_DESCRIPTION = (
    "Server-sent events. `step` (StepEvent) as each agent finishes, comment lines as keep-alives, then exactly one "
    "`result` (ChatResponse) or `error` (ErrorEvent), then `done`."
)


def create_app(
    runner: ChatRunner | None = None,
    token: str | None = None,
    evidence_dir: str = EVIDENCE_DIR,
    warm_up: bool | None = None,
) -> FastAPI:
    runner = runner or ChatRunner()
    secret = os.getenv("AI_SERVICE_TOKEN", "") if token is None else token
    should_warm = (os.getenv("AI_WARMUP", "1") == "1") if warm_up is None else warm_up

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        if not secret:
            log.warning("AI_SERVICE_TOKEN is not set: anyone who can reach this port can use the assistant")
        if should_warm:
            runner.warm_up()
        yield

    app = FastAPI(title="Billing Ops AI service", version="0.1.0", lifespan=lifespan)

    def require_token(x_internal_token: str | None = Header(default=None)) -> None:
        # Constant-time comparison; an unset secret means local development, where the port is loopback-only.
        if secret and not (x_internal_token and hmac.compare_digest(x_internal_token, secret)):
            raise HTTPException(status_code=401, detail="Invalid or missing internal token")

    @app.middleware("http")
    async def request_id(request: Request, call_next):
        rid = request.headers.get("x-request-id") or str(uuid.uuid4())
        request.state.request_id = rid
        response = await call_next(request)
        response.headers["x-request-id"] = rid  # the web tier logs the same id, so one request can be traced end to end
        return response

    @app.get("/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        from agents.llm import get_model_name, resolve_provider

        provider = resolve_provider()
        return HealthResponse(status="ok", ready=runner.ready.is_set(), provider=provider, model=get_model_name(provider))

    @app.post("/chat", response_model=ChatResponse, dependencies=[Depends(require_token)])
    def chat(body: ChatRequest, request: Request) -> ChatResponse:
        try:
            return runner.invoke(body.query, body.msisdn)
        except Busy:
            raise HTTPException(status_code=429, detail="The assistant is busy. Please try again shortly.")
        except Exception:
            log.exception("chat failed (request %s)", request.state.request_id)
            raise HTTPException(status_code=500, detail=FAILURE_MESSAGE)  # never leak internals

    @app.post(
        "/chat/stream",
        dependencies=[Depends(require_token)],
        responses={200: {"description": SSE_DESCRIPTION, "content": {"text/event-stream": {"schema": {"type": "string"}}}}},
    )
    def chat_stream(body: ChatRequest) -> StreamingResponse:
        try:
            events = runner.stream(body.query, body.msisdn)
        except Busy:
            raise HTTPException(status_code=429, detail="The assistant is busy. Please try again shortly.")

        def sse():
            for kind, payload in events:
                if kind == "keepalive":
                    yield ": keepalive\n\n"
                else:
                    yield f"event: {kind}\ndata: {payload.model_dump_json()}\n\n"
            yield "event: done\ndata: {}\n\n"

        return StreamingResponse(
            sse(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
        )

    @app.get("/evidence/{name}", dependencies=[Depends(require_token)], response_class=FileResponse)
    def evidence(name: str):
        # Only a plain PNG file name inside the evidence folder: no separators, no traversal, nothing else on disk.
        path = os.path.join(evidence_dir, name)
        if not _EVIDENCE_NAME.match(name) or not os.path.isfile(path):
            raise HTTPException(status_code=404, detail="Not Found")
        return FileResponse(path, media_type="image/png")

    def custom_openapi() -> dict[str, Any]:
        if app.openapi_schema:
            return app.openapi_schema
        schema = get_openapi(title=app.title, version=app.version, description=app.description, routes=app.routes)
        # The SSE payloads are not request/response models FastAPI knows about; publish them so clients get types.
        for model in (StepEvent, ErrorEvent):
            schema.setdefault("components", {}).setdefault("schemas", {})[model.__name__] = model.model_json_schema(
                ref_template="#/components/schemas/{model}"
            )
        app.openapi_schema = schema
        return schema

    app.openapi = custom_openapi  # type: ignore[method-assign]
    return app


app = create_app()
