"""Unit tests for the agent nodes. LLMs are faked; the billing API runs in-process."""
import pytest

from agents import router
from agents.state import AgentState


class FakeLLM:
    """Returns canned replies in order (repeats the last one), records prompts."""

    def __init__(self, *replies):
        self.replies = list(replies)
        self.prompts = []

    def invoke(self, prompt):
        self.prompts.append(prompt)
        reply = self.replies.pop(0) if len(self.replies) > 1 else self.replies[0]
        return type("Msg", (), {"content": reply})()


# ---------- router ----------

@pytest.mark.parametrize(
    "query,label",
    [
        ("What's my balance for 9876543210?", "balance"),
        ("I want to recharge 9876543210", "balance"),
        ("I was charged wrongly, I want a refund", "dispute"),
        ("I want to dispute my recharge", "dispute"),  # dispute must beat balance's "recharge"
        ("Escalate this to a manager", "escalation"),
        ("Please file a complaint", "escalation"),
        ("Verify that recharging 199 updates the balance", "testgen"),
        # regressions found by agents/routing_check.py
        ("There is an overcharge on my bill", "dispute"),
        ("I was overcharged last week", "dispute"),
        ("I was charged twice for my recharge on 9876543210", "dispute"),
    ],
)
def test_router_regex_paths_never_call_llm(monkeypatch, query, label):
    monkeypatch.setattr(router, "get_llm", lambda: pytest.fail("LLM should not be called"))
    out = router.router_node(AgentState(query=query))
    assert out["route"] == label and out["route_method"] == "regex"


def test_router_policy_question_about_my_plan_is_not_balance(monkeypatch):
    monkeypatch.setattr(router, "get_llm", lambda: FakeLLM("rag"))
    out = router.router_node(AgentState(query="What is the grace period after my plan expires?"))
    assert (out["route"], out["route_method"]) == ("rag", "llm")


def test_router_extracts_msisdn():
    assert router.router_node(AgentState(query="balance of 9876543210"))["msisdn"] == "9876543210"
    assert router.router_node(AgentState(query="balance please"))["msisdn"] is None


def test_router_llm_fallback_and_default(monkeypatch):
    monkeypatch.setattr(router, "get_llm", lambda: FakeLLM("dispute"))
    out = router.router_node(AgentState(query="something ambiguous about my bill"))
    assert (out["route"], out["route_method"]) == ("dispute", "llm")

    monkeypatch.setattr(router, "get_llm", lambda: FakeLLM("I think it is billing!"))
    assert router.router_node(AgentState(query="hmm"))["route"] == "rag"  # invalid label -> rag


# ---------- rag ----------

def test_rag_node_uses_retrieved_context(monkeypatch):
    from agents import rag_agent

    doc = type("Doc", (), {"page_content": "Premium 599 is valid for 56 days."})()
    retriever = type("R", (), {"invoke": lambda self, q: [doc]})()
    llm = FakeLLM("56 days.")
    monkeypatch.setattr(rag_agent, "cached_retriever", lambda: retriever)
    monkeypatch.setattr(rag_agent, "get_llm", lambda: llm)

    out = rag_agent.rag_node(AgentState(query="How long is the 599 plan valid?"))
    assert out["raw_answer"] == "56 days."
    assert out["retrieved_context"] == ["Premium 599 is valid for 56 days."]
    assert "Premium 599 is valid for 56 days." in llm.prompts[0]


# ---------- API-backed nodes (billing / dispute / escalation) ----------

@pytest.fixture
def api(tmp_path, monkeypatch):
    """Point agents' `requests` at the real mock API running in-process on a fresh seeded DB."""
    import requests
    from fastapi.testclient import TestClient

    from mock_api import seed
    from mock_api.main import app

    monkeypatch.setenv("BILLING_DB_PATH", str(tmp_path / "agents.db"))
    seed.seed()
    client = TestClient(app)
    shim = type("RequestsShim", (), {
        "get": staticmethod(client.get),
        "post": staticmethod(client.post),
        "exceptions": requests.exceptions,
    })
    for mod in ("billing_agent", "dispute_agent", "escalation_agent"):
        monkeypatch.setattr(f"agents.{mod}.requests", shim)
    return client


@pytest.fixture
def sop(monkeypatch):
    doc = type("Doc", (), {"page_content": "Escalated disputes are resolved in 10 working days."})()
    retriever = type("R", (), {"invoke": lambda self, q: [doc]})()
    for mod in ("dispute_agent", "escalation_agent"):
        monkeypatch.setattr(f"agents.{mod}.cached_retriever", lambda r=retriever: r)


def test_billing_returns_seeded_balance(api, monkeypatch):
    from agents import billing_agent

    llm = FakeLLM("Your balance is 45.5.")
    monkeypatch.setattr(billing_agent, "get_llm", lambda: llm)
    out = billing_agent.billing_node(AgentState(query="balance?", msisdn="9876543210"))
    assert out["raw_answer"] == "Your balance is 45.5."
    assert "45.5" in llm.prompts[0]  # the LLM was given the real API data
    assert out["tool_calls"][0]["endpoint"] == "/balance"


def test_billing_missing_and_unknown_msisdn(api):
    from agents import billing_agent

    assert "10-digit" in billing_agent.billing_node(AgentState(query="balance?"))["raw_answer"]
    out = billing_agent.billing_node(AgentState(query="balance?", msisdn="0000000000"))
    assert "couldn't find" in out["raw_answer"]


def test_billing_api_down_is_graceful(monkeypatch):
    from agents import billing_agent

    monkeypatch.setenv("FASTAPI_BASE_URL", "http://127.0.0.1:9")  # nothing listens here
    out = billing_agent.billing_node(AgentState(query="balance?", msisdn="9876543210"))
    assert "temporarily unavailable" in out["raw_answer"]


def test_dispute_creates_record_and_parses_fenced_json(api, sop, monkeypatch):
    from agents import dispute_agent

    monkeypatch.setattr(
        dispute_agent, "get_llm",
        lambda: FakeLLM('```json\n{"explanation": "We will refund the duplicate.", "confidence": 0.9}\n```'),
    )
    out = dispute_agent.dispute_node(
        AgentState(query="I was charged twice, Rs 199 refund please", msisdn="9876543210")
    )
    assert out["dispute_confidence"] == 0.8  # decided in code (Rs 199 <= 500); the LLM's 0.0 is ignored
    assert out["raw_answer"] == "We will refund the duplicate."
    rec = api.get(f"/dispute/{out['dispute_id']}").json()
    assert rec["amount_disputed"] == 199.0 and rec["status"] == "open"


def test_dispute_non_json_llm_output_is_shown_as_is(api, sop, monkeypatch):
    from agents import dispute_agent

    monkeypatch.setattr(dispute_agent, "get_llm", lambda: FakeLLM("no json here"))
    out = dispute_agent.dispute_node(AgentState(query="wrong charge", msisdn="9876543210"))
    assert out["dispute_confidence"] == 0.8 and out["raw_answer"] == "no json here"


def test_dispute_over_500_gets_low_confidence(api, sop, monkeypatch):
    from agents import dispute_agent

    monkeypatch.setattr(dispute_agent, "get_llm", lambda: FakeLLM('{"explanation": "Registered."}'))
    out = dispute_agent.dispute_node(AgentState(query="overcharged Rs 800", msisdn="9123456780"))
    assert out["dispute_confidence"] == 0.3
    assert api.get(f"/dispute/{out['dispute_id']}").json()["amount_disputed"] == 800.0


def test_dispute_asks_for_number_when_missing(api):
    from agents import dispute_agent

    out = dispute_agent.dispute_node(AgentState(query="wrong charge"))
    assert "10-digit" in out["raw_answer"] and "dispute_id" not in out


@pytest.mark.parametrize(
    "state,expected",
    [
        ({"query": "wrong charge", "dispute_id": "D-1", "dispute_confidence": 0.3}, "escalation"),
        ({"query": "wrong charge", "dispute_id": "D-1", "dispute_confidence": 0.8}, "moderate"),
        ({"query": "refund and get me a supervisor", "dispute_id": "D-1", "dispute_confidence": 0.9}, "escalation"),
        ({"query": "wrong charge", "dispute_confidence": 1.0}, "moderate"),  # no dispute created -> nothing to escalate
    ],
)
def test_dispute_route_decision(state, expected):
    from agents.dispute_agent import dispute_route_decision

    assert dispute_route_decision(state) == expected


def test_escalation_of_existing_dispute(api, sop, monkeypatch):
    from agents import escalation_agent

    monkeypatch.setattr(escalation_agent, "get_llm", lambda: FakeLLM("Ticket raised."))
    out = escalation_agent.escalation_node(
        AgentState(query="escalate", dispute_id="D-100001", msisdn="9876543210")
    )
    assert out["escalation_ticket_id"].startswith("TCK-")
    assert api.get("/dispute/D-100001").json()["status"] == "escalated"


def test_direct_escalation_registers_dispute_first(api, sop, monkeypatch):
    from agents import escalation_agent

    monkeypatch.setattr(escalation_agent, "get_llm", lambda: FakeLLM("Ticket raised."))
    out = escalation_agent.escalation_node(
        AgentState(query="I want to speak to a manager", msisdn="9123456780")
    )
    assert out["escalation_ticket_id"].startswith("TCK-")
    assert api.get(f"/dispute/{out['dispute_id']}").json()["status"] == "escalated"


def test_escalation_without_number_asks_for_it(api):
    from agents import escalation_agent

    out = escalation_agent.escalation_node(AgentState(query="get me a manager"))
    assert "10-digit" in out["raw_answer"] and "escalation_ticket_id" not in out


# ---------- testgen ----------

VALID_SCENARIO = (
    '{"scenario_name": "valid_recharge", "target_page": "recharge", '
    '"steps": [{"action": "navigate", "target": "http://localhost:8501", "value": null}], '
    '"assertion": {"target": "#receipt_balance", "expected_contains": "244.50"}}'
)


def test_testgen_valid_scenario_is_executed(monkeypatch):
    from agents import testgen_agent

    monkeypatch.setattr(testgen_agent, "get_llm", lambda: FakeLLM(f"```json\n{VALID_SCENARIO}\n```"))
    out = testgen_agent.testgen_node(AgentState(query="Verify recharging 199 updates the balance"))
    assert out["test_scenario"]["scenario_name"] == "valid_recharge"
    assert out["test_result"]["status"] == "pass"  # stub executor until Phase 7
    assert "valid_recharge" in out["raw_answer"]


@pytest.mark.parametrize(
    "reply",
    [
        "not json at all",
        '{"scenario_name": "x"}',  # missing keys
        '{"scenario_name": "x", "target_page": "recharge", "steps": [{"action": "teleport"}], '
        '"assertion": {"target": "a", "expected_contains": "b"}}',  # invalid action
    ],
)
def test_testgen_rejects_unusable_scenarios(monkeypatch, reply):
    from agents import testgen_agent

    monkeypatch.setattr(testgen_agent, "get_llm", lambda: FakeLLM(reply))
    out = testgen_agent.testgen_node(AgentState(query="verify something"))
    assert "couldn't turn" in out["raw_answer"] and "test_result" not in out


# ---------- full graph ----------

@pytest.fixture(autouse=True)
def safe_moderation_llm(monkeypatch):
    """Graph tests exercise the moderation node; keep its LLM safety check offline and 'safe'."""
    from agents import moderation

    monkeypatch.setattr(moderation, "get_llm", lambda: FakeLLM('{"safe": true, "category": null}'))


@pytest.fixture(autouse=True)
def isolated_log(tmp_path, monkeypatch):
    from agents import interaction_log

    monkeypatch.setattr(interaction_log, "LOG_PATH", str(tmp_path / "interactions.jsonl"))
    return tmp_path / "interactions.jsonl"


def test_graph_balance_end_to_end_masks_pii_and_logs(api, monkeypatch, isolated_log):
    from agents import billing_agent
    from agents.graph import app

    monkeypatch.setattr(billing_agent, "get_llm", lambda: FakeLLM("Balance for 9876543210 is 45.5."))
    result = app.invoke({"query": "What's my balance for 9876543210?"})

    assert result["route"] == "balance" and result["route_method"] == "regex"
    assert "9876543210" not in result["moderated_answer"] and result["pii_masked"] is True
    line = isolated_log.read_text(encoding="utf-8")
    assert "9876543210" not in line and "MASKED_MSISDN" in line  # log is masked too


def test_graph_low_confidence_dispute_escalates(api, sop, monkeypatch):
    from agents import dispute_agent, escalation_agent
    from agents.graph import app

    monkeypatch.setattr(dispute_agent, "get_llm", lambda: FakeLLM('{"explanation": "Registered."}'))
    monkeypatch.setattr(escalation_agent, "get_llm", lambda: FakeLLM("Escalated; ticket raised."))
    result = app.invoke({"query": "I was charged wrongly on 9876543210, Rs 800 refund"})  # > Rs 500 -> escalate

    assert result["route"] == "dispute"
    assert result["escalation_ticket_id"].startswith("TCK-")
    assert api.get(f"/dispute/{result['dispute_id']}").json()["status"] == "escalated"


def test_graph_confident_dispute_does_not_escalate(api, sop, monkeypatch):
    from agents import dispute_agent
    from agents.graph import app

    monkeypatch.setattr(dispute_agent, "get_llm", lambda: FakeLLM('{"explanation": "Dispute registered."}'))
    result = app.invoke({"query": "I was charged wrongly on 9876543210, Rs 199 refund"})
    assert "escalation_ticket_id" not in result and "Dispute registered" in result["moderated_answer"]
