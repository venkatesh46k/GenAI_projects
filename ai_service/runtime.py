"""Runs the agent graph for the AI service: lazy loading, a concurrency cap, warm-up, and progress streaming."""
import logging
import os
import queue
import re
import threading
from typing import Any, Callable, Iterator

from ai_service.schemas import ChatResponse, ErrorEvent, StepEvent, TestResult

log = logging.getLogger("ai_service")

FAILURE_MESSAGE = "The assistant ran into a problem. Please try again."
NO_ANSWER_MESSAGE = "Sorry, I could not produce an answer."
_SAFE_EVIDENCE_NAME = re.compile(r"^[A-Za-z0-9_.-]+\.png$")

STEP_MESSAGES = {
    "router": "Understood the request",
    "rag": "Searched the knowledge base",
    "balance": "Checked the billing system",
    "dispute": "Registered the dispute",
    "escalation": "Escalated to a specialist",
    "testgen": "Ran the browser test",
    "moderate": "Checked the reply for privacy and safety",
}


class Busy(Exception):
    """Every slot is taken: the caller should retry shortly."""


def _default_loader():
    from agents.graph import app  # heavy import (ML libraries): only when the first request needs it

    return app


def _default_warmup() -> None:
    from rag.retriever import cached_retriever

    cached_retriever()  # loads the embedding model and opens the vector store once


def evidence_url(path: str | None) -> str | None:
    """Screenshot file -> URL path this service serves. Only the file name is ever exposed, never the disk path."""
    name = os.path.basename(path or "")
    return f"/evidence/{name}" if _SAFE_EVIDENCE_NAME.match(name) else None


def build_response(state: dict[str, Any]) -> ChatResponse:
    test = state.get("test_result")
    return ChatResponse(
        answer=state.get("moderated_answer") or NO_ANSWER_MESSAGE,
        route=state.get("route") or "",
        route_method=state.get("route_method") or "",
        pii_masked=bool(state.get("pii_masked")),
        safety_flag=state.get("safety_flag"),
        tool_calls=list(state.get("tool_calls") or []),
        sources=[passage[:500] for passage in (state.get("retrieved_context") or [])][:4],
        dispute_id=state.get("dispute_id"),
        ticket_id=state.get("escalation_ticket_id"),
        test_result=TestResult(
            status="pass" if test.get("status") == "pass" else "fail",
            detail=str(test.get("detail", "")),
            evidence_url=evidence_url(test.get("evidence_path")),
            steps_completed=test.get("steps_completed"),
        )
        if test
        else None,
    )


def step_message(node: str, state: dict[str, Any]) -> str:
    if node == "router":
        return f"Routed to {state.get('route')} ({state.get('route_method')})"
    return STEP_MESSAGES.get(node, node)


class ChatRunner:
    def __init__(
        self,
        graph_loader: Callable[[], Any] = _default_loader,
        warmup: Callable[[], None] = _default_warmup,
        max_concurrent: int | None = None,
        keepalive_seconds: float = 10.0,
    ):
        self._load = graph_loader
        self._warmup = warmup
        self._graph: Any = None
        self._graph_lock = threading.Lock()
        self._slots = threading.BoundedSemaphore(max_concurrent or int(os.getenv("MAX_CONCURRENT_CHATS", "4")))
        self.keepalive_seconds = keepalive_seconds
        self.ready = threading.Event()

    def graph(self):
        with self._graph_lock:  # two first requests must not both load the models
            if self._graph is None:
                self._graph = self._load()
            return self._graph

    def warm_up(self) -> threading.Thread:
        """Load the models in the background so the first real question does not pay for it."""

        def load() -> None:
            try:
                self.graph()
                self._warmup()
                self.ready.set()
                log.info("models loaded: the assistant is ready")
            except Exception:
                log.exception("warm-up failed; the first request will retry")

        thread = threading.Thread(target=load, name="ai-warmup", daemon=True)
        thread.start()
        return thread

    @staticmethod
    def _initial(query: str, msisdn: str | None) -> dict[str, Any]:
        return {"query": query, "msisdn": msisdn}

    def _take_slot(self) -> None:
        if not self._slots.acquire(blocking=False):
            raise Busy()

    def invoke(self, query: str, msisdn: str | None) -> ChatResponse:
        self._take_slot()
        try:
            state = self.graph().invoke(self._initial(query, msisdn))
        finally:
            self._slots.release()
        self.ready.set()
        return build_response(state)

    def stream(self, query: str, msisdn: str | None) -> Iterator[tuple[str, Any]]:
        """Yield ("step", StepEvent) as each agent node finishes, ("keepalive", None) while waiting, then one
        ("result", ChatResponse) or ("error", ErrorEvent). Raises Busy immediately (before any event) if full."""
        self._take_slot()  # taken here, not inside the generator, so Busy surfaces as an HTTP 429 up front
        events: queue.Queue = queue.Queue()

        def work() -> None:
            try:
                for update in self.graph().stream(self._initial(query, msisdn), stream_mode="updates"):
                    for node, data in update.items():
                        events.put(("step", node, data))
                events.put(("done", None, None))
            except Exception:
                log.exception("chat stream failed")
                events.put(("error", None, None))
            finally:
                self._slots.release()  # released when the work really ends, even if the client already left

        threading.Thread(target=work, name="ai-stream", daemon=True).start()
        return self._events(query, msisdn, events)

    def _events(self, query: str, msisdn: str | None, events: queue.Queue) -> Iterator[tuple[str, Any]]:
        state = self._initial(query, msisdn)
        while True:
            try:
                kind, node, data = events.get(timeout=self.keepalive_seconds)
            except queue.Empty:
                yield "keepalive", None  # bytes on the wire keep proxies from closing a quiet connection
                continue
            if kind == "step":
                state.update(data or {})
                yield "step", StepEvent(node=node, message=step_message(node, state))
            elif kind == "done":
                self.ready.set()
                yield "result", build_response(state)
                return
            else:
                yield "error", ErrorEvent(detail=FAILURE_MESSAGE)
                return
