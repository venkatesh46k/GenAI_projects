"""AI service tests: the agent graph is faked, so no models, no LLM, no network."""
import json
import os
import threading
import time

import pytest
from fastapi.testclient import TestClient

from ai_service.export_openapi import PATH as OPENAPI_PATH, render
from ai_service.main import create_app
from ai_service.runtime import FAILURE_MESSAGE, ChatRunner

STATE = {
    "query": "what is the grace period?",
    "route": "rag",
    "route_method": "llm",
    "raw_answer": "raw",
    "moderated_answer": "15 days.",
    "pii_masked": False,
    "safety_flag": None,
    "retrieved_context": ["passage " + "x" * 900] * 6,
    "tool_calls": [{"endpoint": "/balance"}],
}


class FakeGraph:
    def __init__(self, state=None, updates=None, delay=0.0, error=None, gate=None):
        self.state = state if state is not None else STATE
        self.updates = updates
        self.delay, self.error, self.gate = delay, error, gate
        self.inputs = []

    def _wait(self):
        if self.gate:
            self.gate.wait(5)
        if self.delay:
            time.sleep(self.delay)
        if self.error:
            raise self.error

    def invoke(self, initial):
        self.inputs.append(initial)
        self._wait()
        return self.state

    def stream(self, initial, stream_mode="updates"):
        assert stream_mode == "updates"
        self.inputs.append(initial)
        for update in self.updates or [
            {"router": {"route": "rag", "route_method": "llm"}},
            {"rag": {"raw_answer": "raw", "retrieved_context": ["p1"]}},
            {"moderate": {"moderated_answer": "15 days.", "pii_masked": False}},
        ]:
            self._wait()
            yield update


def make(graph=None, token="", evidence_dir=None, **runner_kwargs):
    graph = graph or FakeGraph()
    runner = ChatRunner(graph_loader=lambda: graph, warmup=lambda: None, **runner_kwargs)
    kwargs = {"evidence_dir": evidence_dir} if evidence_dir else {}
    return TestClient(create_app(runner, token=token, warm_up=False, **kwargs)), graph, runner


def sse(text):
    """Parse a server-sent-events body into [(event, data)], skipping comments."""
    events = []
    for block in text.strip().split("\n\n"):
        lines = [line for line in block.splitlines() if line and not line.startswith(":")]
        if lines:
            name = next(line[7:] for line in lines if line.startswith("event: "))
            data = next(line[6:] for line in lines if line.startswith("data: "))
            events.append((name, json.loads(data)))
    return events


# ---------------------------------------------------------------- /chat


def test_chat_maps_the_agent_state_to_the_response_contract():
    client, graph, _ = make()
    r = client.post("/chat", json={"query": "what is the grace period?", "msisdn": "9876543210"})
    assert r.status_code == 200
    body = r.json()
    assert body["answer"] == "15 days." and body["route"] == "rag" and body["route_method"] == "llm"
    assert body["tool_calls"] == [{"endpoint": "/balance"}]
    assert len(body["sources"]) == 4 and all(len(s) <= 500 for s in body["sources"])  # capped
    assert graph.inputs == [{"query": "what is the grace period?", "msisdn": "9876543210"}]


def test_the_customer_context_is_optional():
    client, graph, _ = make()
    assert client.post("/chat", json={"query": "hi"}).status_code == 200
    assert graph.inputs[0]["msisdn"] is None


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"query": ""},
        {"query": "x" * 2001},
        {"query": "hi", "msisdn": "123"},
        {"query": "hi", "msisdn": "98765432ab"},
        {"query": "hi", "role": "admin"},  # unknown fields are rejected, not ignored
    ],
)
def test_invalid_requests_are_422_and_never_reach_the_agents(body):
    client, graph, _ = make()
    assert client.post("/chat", json=body).status_code == 422
    assert graph.inputs == []


def test_a_failing_agent_is_a_generic_500_with_no_internals():
    client, _, _ = make(FakeGraph(error=RuntimeError("secret internals: /etc/keys")))
    r = client.post("/chat", json={"query": "hi"})
    assert r.status_code == 500 and r.json() == {"detail": FAILURE_MESSAGE}
    assert "secret" not in r.text and "/etc" not in r.text


def test_a_browser_test_result_exposes_a_url_never_a_disk_path():
    state = {
        **STATE,
        "route": "testgen",
        "test_result": {
            "status": "pass",
            "detail": "Expected '244.50' found",
            "steps_completed": 9,
            "evidence_path": r"C:\Users\someone\repo\tests_qa\evidence\valid_recharge_e2e.png",
        },
    }
    client, _, _ = make(FakeGraph(state))
    body = client.post("/chat", json={"query": "verify"}).json()
    assert body["test_result"] == {
        "status": "pass",
        "detail": "Expected '244.50' found",
        "steps_completed": 9,
        "evidence_url": "/evidence/valid_recharge_e2e.png",
    }
    assert "someone" not in json.dumps(body) and "C:" not in json.dumps(body)


def test_an_unsafe_evidence_file_name_is_dropped():
    state = {**STATE, "test_result": {"status": "fail", "detail": "x", "evidence_path": "/tmp/../etc/passwd"}}
    client, _, _ = make(FakeGraph(state))
    assert client.post("/chat", json={"query": "v"}).json()["test_result"]["evidence_url"] is None


def test_a_missing_answer_gets_a_friendly_fallback():
    client, _, _ = make(FakeGraph({**STATE, "moderated_answer": None}))
    assert "could not produce an answer" in client.post("/chat", json={"query": "hi"}).json()["answer"]


# ---------------------------------------------------------------- auth, health, request ids


def test_the_internal_token_is_required_when_configured():
    client, _, _ = make(token="s3cret")
    body = {"query": "hi"}
    assert client.post("/chat", json=body).status_code == 401
    assert client.post("/chat", json=body, headers={"x-internal-token": "wrong"}).status_code == 401
    assert client.post("/chat", json=body, headers={"x-internal-token": "s3cret"}).status_code == 200
    assert client.post("/chat/stream", json=body).status_code == 401
    assert client.get("/health").status_code == 200  # health stays open for orchestrators


def test_health_reports_readiness_and_the_model(monkeypatch):
    monkeypatch.setenv("ACTIVE_PROVIDER", "groq")
    monkeypatch.setenv("GROQ_TEXT_MODEL", "some-model")
    client, _, _ = make()
    assert client.get("/health").json() == {"status": "ok", "ready": False, "provider": "groq", "model": "some-model"}
    client.post("/chat", json={"query": "hi"})
    assert client.get("/health").json()["ready"] is True


def test_the_request_id_is_echoed_or_generated():
    client, _, _ = make()
    assert client.get("/health", headers={"x-request-id": "trace-1"}).headers["x-request-id"] == "trace-1"
    assert len(client.get("/health").headers["x-request-id"]) == 36


# ---------------------------------------------------------------- concurrency and warm-up


def test_a_full_service_answers_429_instead_of_queueing_forever():
    gate = threading.Event()
    client, _, _ = make(FakeGraph(gate=gate), max_concurrent=1)
    first = threading.Thread(target=lambda: client.post("/chat", json={"query": "slow"}))
    first.start()
    time.sleep(0.2)  # the first request now holds the only slot
    try:
        assert client.post("/chat", json={"query": "second"}).status_code == 429
        assert client.post("/chat/stream", json={"query": "third"}).status_code == 429
    finally:
        gate.set()
        first.join()
    assert client.post("/chat", json={"query": "after"}).status_code == 200  # the slot was released


def test_the_graph_is_loaded_once_even_when_requests_race():
    loads = []

    def loader():
        loads.append(1)
        time.sleep(0.2)
        return FakeGraph()

    runner = ChatRunner(graph_loader=loader, warmup=lambda: None, max_concurrent=8)
    threads = [threading.Thread(target=lambda: runner.invoke("hi", None)) for _ in range(6)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert len(loads) == 1


def test_warm_up_loads_the_models_and_marks_the_service_ready():
    calls = []
    runner = ChatRunner(graph_loader=lambda: calls.append("graph") or FakeGraph(), warmup=lambda: calls.append("index"))
    runner.warm_up().join(5)
    assert calls == ["graph", "index"] and runner.ready.is_set()


def test_a_failed_warm_up_does_not_crash_and_leaves_the_service_not_ready():
    def boom():
        raise RuntimeError("model download failed")

    runner = ChatRunner(graph_loader=lambda: FakeGraph(), warmup=boom)
    runner.warm_up().join(5)
    assert not runner.ready.is_set()


# ---------------------------------------------------------------- streaming


def test_the_stream_reports_each_step_then_the_final_result():
    client, _, _ = make()
    r = client.post("/chat/stream", json={"query": "grace period?"})
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/event-stream")
    events = sse(r.text)
    assert [name for name, _ in events] == ["step", "step", "step", "result", "done"]
    assert events[0][1] == {"node": "router", "message": "Routed to rag (llm)"}
    assert events[1][1]["node"] == "rag"
    result = events[3][1]
    assert result["answer"] == "15 days." and result["route"] == "rag" and result["sources"] == ["p1"]


def test_a_failure_mid_stream_becomes_an_error_event_with_a_safe_message():
    graph = FakeGraph(updates=[{"router": {"route": "rag", "route_method": "llm"}}])
    original = graph.stream

    def failing(initial, stream_mode="updates"):
        yield from original(initial, stream_mode)
        raise RuntimeError("secret internals")

    graph.stream = failing
    client, _, _ = make(graph)
    events = sse(client.post("/chat/stream", json={"query": "hi"}).text)
    assert [n for n, _ in events] == ["step", "error", "done"]
    assert events[1][1] == {"detail": FAILURE_MESSAGE} and "secret" not in json.dumps(events)


def test_keepalives_are_sent_while_the_agents_are_slow():
    client, _, _ = make(FakeGraph(delay=0.4), keepalive_seconds=0.1)
    text = client.post("/chat/stream", json={"query": "hi"}).text
    assert text.count(": keepalive") >= 3
    assert [n for n, _ in sse(text)][-2:] == ["result", "done"]  # and the answer still arrives


def test_the_stream_and_the_plain_endpoint_agree_on_the_result():
    client, _, _ = make()
    plain = client.post("/chat", json={"query": "hi"}).json()
    events = sse(client.post("/chat/stream", json={"query": "hi"}).text)
    streamed = next(data for name, data in events if name == "result")
    assert streamed["answer"] == plain["answer"] and streamed["route"] == plain["route"]


# ---------------------------------------------------------------- evidence images


@pytest.fixture
def evidence(tmp_path):
    folder = tmp_path / "evidence"
    folder.mkdir()
    (folder / "ok.png").write_bytes(b"\x89PNG fake")
    (folder / "notes.txt").write_text("not an image")
    (tmp_path / "secret.png").write_bytes(b"outside the folder")
    return folder


def test_evidence_screenshots_are_served(evidence):
    client, _, _ = make(evidence_dir=str(evidence))
    r = client.get("/evidence/ok.png")
    assert r.status_code == 200 and r.headers["content-type"] == "image/png" and r.content.startswith(b"\x89PNG")


@pytest.mark.parametrize(
    "name", ["missing.png", "notes.txt", "..%2Fsecret.png", "%2e%2e%2fsecret.png", "a%2Fb.png", "..%5Csecret.png"]
)
def test_evidence_refuses_anything_but_a_png_in_the_folder(evidence, name):
    client, _, _ = make(evidence_dir=str(evidence))
    r = client.get(f"/evidence/{name}")
    assert r.status_code in (404, 422) and b"outside the folder" not in r.content


def test_evidence_requires_the_token(evidence):
    client, _, _ = make(token="s3cret", evidence_dir=str(evidence))
    assert client.get("/evidence/ok.png").status_code == 401
    assert client.get("/evidence/ok.png", headers={"x-internal-token": "s3cret"}).status_code == 200


# ---------------------------------------------------------------- the contract file


def test_the_committed_openapi_contract_is_current():
    """Clients generate TypeScript types from contracts/ai-service.openapi.json. If this fails, run
    `python -m ai_service.export_openapi` and commit the result."""
    assert os.path.exists(OPENAPI_PATH), "contracts/ai-service.openapi.json is missing: run ai_service.export_openapi"
    with open(OPENAPI_PATH, encoding="utf-8") as f:
        assert json.load(f) == json.loads(render())


def test_the_contract_publishes_the_streaming_event_types():
    schemas = json.loads(render())["components"]["schemas"]
    assert {"ChatRequest", "ChatResponse", "TestResult", "StepEvent", "ErrorEvent", "HealthResponse"} <= set(schemas)
