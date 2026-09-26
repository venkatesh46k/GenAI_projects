"""Offline tests for the console: display helpers, plus the real app driven headlessly with a fake billing API."""
import sys
import types

import pytest
from streamlit.testing.v1 import AppTest

from ui import api_client, console_data as cd

# ---------------------------------------------------------------- display helpers


def test_money_and_timestamps():
    assert cd.money(1234.5) == "₹1,234.50"
    assert cd.fmt_ts("2026-09-26T00:41:41") == "26 Sep 2026, 00:41"
    assert cd.fmt_ts("2026-09-10") == "10 Sep 2026"
    assert cd.fmt_ts(None) == "-" and cd.fmt_ts("not a date") == "not a date"


def test_customer_option_and_status_badges():
    assert cd.customer_option({"msisdn": "9876543210", "plan_id": "PLAN_199", "status": "active"}) == (
        "9876543210  ·  active"
    )
    assert cd.customer_option({"msisdn": "9988776655", "status": "barred"}).endswith("barred")  # must not be clipped
    assert len(cd.customer_option({"msisdn": "9988776655", "status": "barred"})) <= 25
    assert "Barred" in cd.status_badge_html("barred") and "#c5221f" in cd.status_badge_html("barred")
    assert "Active" in cd.status_badge_html("active")
    assert "Weird" in cd.status_badge_html("weird")  # unknown statuses still render


@pytest.mark.parametrize(
    "balance,status,expected",
    [(120.0, "active", None), (4.99, "active", "below"), (5.0, "active", None), (200.0, "barred", "barred")],
)
def test_balance_warning(balance, status, expected):
    warning = cd.balance_warning(balance, status)
    assert (warning is None) if expected is None else (expected in warning)


def test_cdr_usage_is_readable_per_call_type():
    frame = cd.cdr_frame(
        [
            {"timestamp": "2026-09-20T10:00:00", "call_type": "voice", "duration_sec": 125, "data_mb": 0, "charge": 1.5},
            {"timestamp": "2026-09-20T11:00:00", "call_type": "data", "duration_sec": 0, "data_mb": 128.44, "charge": 0.0},
            {"timestamp": "2026-09-20T12:00:00", "call_type": "sms", "duration_sec": None, "data_mb": None, "charge": 0.5},
        ]
    )
    assert list(frame["Usage"]) == ["2m 05s", "128.4 MB", "1 SMS"]
    assert list(frame["Charge"]) == ["₹1.50", "₹0.00", "₹0.50"]


def test_empty_lists_still_produce_frames_with_the_right_columns():
    assert list(cd.cdr_frame([]).columns) == ["Time", "Type", "Usage", "Charge"]
    assert list(cd.transaction_frame([]).columns) == ["Time", "Type", "Amount", "Balance after", "Reference"]
    assert list(cd.dispute_frame([]).columns) == ["Dispute", "Opened", "Amount", "Status", "Reason"]


def test_route_label():
    assert cd.route_label({"route": "dispute", "route_method": "regex"}) == "dispute (regex)"
    assert cd.route_label({}) == ""


# ---------------------------------------------------------------- the app, headless, with a fake API

SUBSCRIBERS = [
    {"msisdn": "9123456780", "plan_id": "PLAN_599", "balance": 120.0, "status": "active", "last_recharge_date": "2026-09-05"},
    {"msisdn": "9876543210", "plan_id": "PLAN_199", "balance": 45.5, "status": "active", "last_recharge_date": "2026-09-10"},
    {"msisdn": "9988776655", "plan_id": "PLAN_199", "balance": 5.0, "status": "barred", "last_recharge_date": "2026-08-20"},
]
PLANS = {
    "PLAN_199": {"plan_id": "PLAN_199", "name": "Basic 199", "price": 199.0, "validity_days": 28, "data_per_day_gb": 1.5, "voice_minutes": 1000, "sms_per_day": 100},
    "PLAN_599": {"plan_id": "PLAN_599", "name": "Premium 599", "price": 599.0, "validity_days": 56, "data_per_day_gb": 2.5, "voice_minutes": 3000, "sms_per_day": 100},
}
CDRS = [{"cdr_id": "a1", "call_type": "voice", "duration_sec": 90, "data_mb": None, "charge": 1.0, "timestamp": "2026-09-20T10:00:00"}]
DISPUTES = [{"dispute_id": "D-100001", "msisdn": "9876543210", "reason": "Charged twice", "amount_disputed": 199.0, "status": "open", "created_at": "2026-09-01T09:00:00"}]


class FakeApi:
    """Replaces api_client._request; records the calls so tests can assert on what the UI asked for."""

    def __init__(self):
        self.calls = []
        self.down = False

    def __call__(self, method, path, **kwargs):
        self.calls.append((method, path, kwargs))
        if self.down:
            raise api_client.ApiError("The billing system is temporarily unavailable. Please try again.")
        if path == "/subscribers":
            return SUBSCRIBERS
        if path.startswith("/balance/"):
            sub = next(s for s in SUBSCRIBERS if s["msisdn"] == path.rsplit("/", 1)[1])
            return {"msisdn": sub["msisdn"], "balance": sub["balance"], "plan_id": sub["plan_id"], "status": sub["status"]}
        if path.startswith("/plans/"):
            return PLANS[path.rsplit("/", 1)[1]]
        if path.startswith("/cdr/"):
            return CDRS
        if path.startswith("/transactions/"):
            return []
        if path == "/disputes":
            return DISPUTES if kwargs["params"]["msisdn"] == "9876543210" else []
        if path == "/recharge":
            return {"txn_id": "TXN-abc12345", "new_balance": kwargs["json"]["amount"] + 45.5, "status": "success"}
        if path.endswith("/escalate"):
            return {"dispute_id": "D-100001", "status": "escalated", "ticket_id": "TCK-777"}
        raise AssertionError(f"unexpected API call {method} {path}")


@pytest.fixture(autouse=True)
def no_model_warmup(monkeypatch):
    """The console preloads the ML models in a background thread; never do that in unit tests."""
    monkeypatch.setenv("CONSOLE_WARMUP", "0")


@pytest.fixture
def api(monkeypatch):
    fake = FakeApi()
    monkeypatch.setattr(api_client, "_request", fake)
    return fake


def run_app() -> AppTest:
    at = AppTest.from_file("chat_app.py", default_timeout=30)
    at.run()
    return at


def texts(at: AppTest) -> str:
    return " ".join(str(getattr(e, "value", "")) for e in at.markdown) + " ".join(str(w.value) for w in at.warning)


def test_customer_360_shows_the_profile_metrics_and_tabs(api):
    at = run_app()
    assert not at.exception
    by_label = {m.label: m.value for m in at.metric}
    assert by_label["Balance"] == "₹120.00" and by_label["Plan"] == "Premium 599" and by_label["Validity"] == "56 days"
    assert [t.label for t in at.tabs] == ["Usage (1)", "Transactions (0)", "Disputes (0)"]
    assert not at.warning  # a healthy account has no banner


def test_switching_customer_updates_the_view_and_a_barred_number_warns(api):
    at = run_app()
    at.selectbox(key="customer").select("9988776655").run()
    assert not at.exception
    assert any("barred" in w.value for w in at.warning)
    assert "9988776655" in texts(at)


def test_disputes_tab_lets_an_agent_escalate(api):
    at = run_app()
    at.selectbox(key="customer").select("9876543210").run()
    assert at.tabs[2].label == "Disputes (1)"
    at.button(key="escalate_btn").click().run()
    assert not at.exception
    assert ("POST", "/dispute/D-100001/escalate", {}) in [(m, p, k) for m, p, k in api.calls]


def test_the_console_explains_when_the_billing_api_is_down(api):
    api.down = True
    at = run_app()
    assert any("temporarily unavailable" in e.value for e in at.error)
    assert not at.metric  # nothing else rendered


def test_recharge_view_is_prefilled_with_the_selected_customer_and_completes(api):
    at = run_app()
    at.selectbox(key="customer").select("9876543210")
    at.radio(key="nav").set_value("Recharge").run()
    assert at.text_input(key="msisdn_input").value == "9876543210"

    at.number_input(key="amount_input").set_value(199.0)
    at.button(key="continue_btn").click().run()
    assert any("Confirm your recharge" in s.value for s in at.subheader)
    at.button(key="confirm_btn").click().run()
    assert not at.exception
    assert any("Recharge successful" in s.value for s in at.success)
    assert any(c[1] == "/recharge" and c[2]["json"] == {"msisdn": "9876543210", "amount": 199.0, "plan_id": "PLAN_199"} for c in api.calls)


def test_changing_customer_resets_a_half_finished_recharge(api):
    at = run_app()
    at.selectbox(key="customer").select("9876543210")
    at.radio(key="nav").set_value("Recharge").run()
    at.number_input(key="amount_input").set_value(99.0)
    at.button(key="continue_btn").click().run()  # now on the confirmation page for the first customer
    at.selectbox(key="customer").select("9123456780").run()
    assert at.text_input(key="msisdn_input").value == "9123456780"  # back on a fresh first page


# ---------------------------------------------------------------- copilot panel


class FakeGraph:
    def __init__(self, result=None, error=None):
        self.result, self.error, self.calls = result or {}, error, []

    def invoke(self, state):
        self.calls.append(state)
        if self.error:
            raise self.error
        return self.result


@pytest.fixture
def graph(monkeypatch):
    fake = FakeGraph(
        {
            "moderated_answer": "Your balance is [MASKED_MSISDN]: 45.50.",
            "route": "balance", "route_method": "regex", "pii_masked": True,
            "tool_calls": [{"endpoint": "/balance"}],
        }
    )
    module = types.ModuleType("agents.graph")
    module.app = fake
    monkeypatch.setitem(sys.modules, "agents.graph", module)
    return fake


def open_copilot(api) -> AppTest:
    at = run_app()
    at.selectbox(key="customer").select("9876543210")
    at.radio(key="nav").set_value("Copilot").run()
    return at


def test_copilot_sends_the_selected_customer_as_context_and_shows_the_answer(api, graph):
    at = open_copilot(api)
    at.chat_input[0].set_value("what's the balance?").run()
    assert not at.exception
    assert graph.calls == [{"query": "what's the balance?", "msisdn": "9876543210"}]
    rendered = " ".join(m.value for m in at.markdown)
    assert "Your balance is [MASKED_MSISDN]: 45.50." in rendered
    assert "balance (regex)" in rendered  # the "how this was answered" panel names the route


def test_copilot_context_can_be_switched_off(api, graph):
    at = open_copilot(api)
    at.toggle(key="use_customer").set_value(False).run()
    at.chat_input[0].set_value("what is a CDR?").run()
    assert graph.calls[0]["msisdn"] is None


def test_a_copilot_crash_shows_a_friendly_message_not_a_traceback(api, graph):
    graph.error = RuntimeError("model exploded")
    at = open_copilot(api)
    at.chat_input[0].set_value("hello").run()
    assert not at.exception
    assert any("ran into a problem" in m.value for m in at.markdown)
    assert not any("model exploded" in str(m.value) for m in at.markdown)


def test_suggested_prompts_are_offered_on_an_empty_chat(api, graph):
    at = open_copilot(api)
    assert len([b for b in at.button if b.key and b.key.startswith("suggest_")]) == len(cd.SUGGESTED_PROMPTS)


def test_copilot_explains_a_missing_llm_configuration_instead_of_failing(api, graph, monkeypatch):
    monkeypatch.setenv("DEPLOY_LLM_PROBLEM", "GROQ_API_KEY is not set")
    at = open_copilot(api)
    assert not at.exception
    assert any("GROQ_API_KEY is not set" in w.value for w in at.warning)
    assert not at.chat_input  # nothing to type into: the Copilot cannot answer without a model
    assert graph.calls == []
