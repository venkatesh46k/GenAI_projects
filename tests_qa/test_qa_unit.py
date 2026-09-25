"""Offline tests for the QA agent: no browser, no Node, no running services (the MCP client is faked)."""
import pytest

from agents.testgen_agent import TESTGEN_PROMPT, is_valid_scenario
from tests_qa import run_agent_tests as runner
from tests_qa.mcp_client import StepFailure, _selector_problem, extract_text
from tests_qa.scenarios import BY_NAME, SCENARIOS, SEL

# ---------- extract_text: real Playwright MCP snapshot shapes ----------

SNAPSHOT = """### Page
- Page URL: http://localhost:8501/
### Snapshot
```yaml
- paragraph [ref=e91]: "Amount: 199.00"
```
"""

TREE = """```yaml
- generic [ref=e1]:
  - alert [ref=e2]:
    - paragraph [ref=e3]: Enter a valid 10-digit number
  - textbox "Mobile number" [ref=e4]:
    - /placeholder: ""
  - button "Continue" [ref=e5] [cursor=pointer]
  - text: Recharge
```"""


def test_extract_text_reads_a_quoted_paragraph():
    assert extract_text(SNAPSHOT) == "Amount: 199.00"


def test_extract_text_reads_a_tree_and_skips_metadata():
    text = extract_text(TREE)
    assert "Enter a valid 10-digit number" in text and "Mobile number" in text and "Continue" in text
    assert "placeholder" not in text and "ref=" not in text


def test_extract_text_of_nothing_is_empty():
    assert extract_text("### Page\n- Page URL: x") == ""


def test_selector_errors_become_readable_reasons():
    raw = "### Error\nTimeoutError: locator.click: Timeout 5000ms exceeded.\nCall log: - waiting for locator('.st-key-x')"
    assert _selector_problem(raw, ".st-key-x") == "selector not found: .st-key-x"
    assert _selector_problem("Timeout 5000ms exceeded", "text") == "timed out on: text"


# ---------- placeholder resolution ----------

def test_resolve_fills_the_live_balance_plus_n():
    assert runner.resolve("{pre_balance+199}", 45.5) == "244.50"
    assert runner.resolve("{pre_balance + 99}", 100) == "199.00"
    assert runner.resolve("{pre_balance}", 45.5) == "45.50"
    assert runner.resolve("Enter a valid 10-digit number", None) == "Enter a valid 10-digit number"


def test_resolve_without_a_balance_is_a_clear_error():
    with pytest.raises(ValueError, match="pre_balance"):
        runner.resolve("{pre_balance+1}", None)


def test_msisdn_is_inferred_from_the_steps_when_setup_is_missing():
    scenario = {"steps": [{"action": "fill", "target": SEL["msisdn"], "value": "9123456780"}]}
    assert runner.infer_msisdn(scenario) == "9123456780"
    assert runner.infer_msisdn({"steps": [], "setup": {"msisdn": "9988776655"}}) == "9988776655"
    assert runner.infer_msisdn({"steps": []}) == runner.DEFAULT_MSISDN


# ---------- the scenario data itself ----------

def test_there_are_five_scenarios_with_unique_names():
    assert len(SCENARIOS) == 5 and len(BY_NAME) == 5


@pytest.mark.parametrize("scenario", SCENARIOS, ids=[s["scenario_name"] for s in SCENARIOS])
def test_every_scenario_is_valid_for_the_testgen_schema(scenario):
    assert is_valid_scenario(scenario)


@pytest.mark.parametrize("scenario", SCENARIOS, ids=[s["scenario_name"] for s in SCENARIOS])
def test_every_selector_a_scenario_uses_is_known(scenario):
    """Guards against typos: an unknown selector would only surface as a slow browser timeout."""
    known = set(SEL.values()) | {step["target"] for step in scenario["steps"] if step["action"] in {"navigate", "wait_for"}}
    used = {s["target"] for s in scenario["steps"] if s["action"] in {"fill", "click", "select", "read_text"}}
    used.add(scenario["assertion"]["target"])
    assert used <= known, used - known


def test_the_testgen_prompt_lists_every_selector_the_ui_exposes():
    for selector in SEL.values():
        assert selector in TESTGEN_PROMPT, selector


@pytest.mark.parametrize(
    "scenario,ok",
    [
        ({"scenario_name": "x", "target_page": "recharge", "steps": [{"action": "click", "target": ".a", "value": None}], "assertion": {"target": ".a", "expected_contains": "b"}}, True),
        ({"scenario_name": "x", "target_page": "elsewhere", "steps": [{"action": "click", "target": ".a"}], "assertion": {"target": ".a", "expected_contains": "b"}}, False),
        ({"scenario_name": "x", "target_page": "recharge", "steps": [{"action": "teleport", "target": ".a"}], "assertion": {"target": ".a", "expected_contains": "b"}}, False),
        ({"scenario_name": "x", "target_page": "recharge", "steps": [{"action": "fill", "target": ".a"}], "assertion": {"target": ".a", "expected_contains": "b"}}, False),
        ({"scenario_name": "x", "target_page": "recharge", "steps": [{"action": "click", "target": ""}], "assertion": {"target": ".a", "expected_contains": "b"}}, False),
        ({"scenario_name": "x", "target_page": "recharge", "steps": [{"action": "click", "target": ".a"}], "assertion": {"target": ".a"}}, False),
        (None, False),
    ],
)
def test_scenario_validation(scenario, ok):
    assert is_valid_scenario(scenario) is ok


# ---------- the runner, with a fake browser ----------

class FakeClient:
    """Stands in for MCPClient. `pages` maps a selector to the text a read_text should return."""

    instances = []

    def __init__(self, headless=True, **kwargs):
        self.performed, self.shots = [], []
        FakeClient.instances.append(self)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def perform(self, action, target, value):
        if target in FakeClient.broken:
            raise StepFailure(f"selector not found: {target}")
        self.performed.append((action, target, value))

    async def read_text(self, selector):
        return FakeClient.pages.get(selector, "")

    async def screenshot(self, name):
        self.shots.append(name)
        return f"evidence/{name}.png"


@pytest.fixture
def fake_env(monkeypatch):
    FakeClient.instances, FakeClient.pages, FakeClient.broken = [], {}, set()
    balances = {"value": 100.0}
    monkeypatch.setattr(runner, "MCPClient", FakeClient)
    monkeypatch.setattr(runner, "_preflight", lambda: None)
    monkeypatch.setattr(runner, "fetch_balance", lambda msisdn: balances["value"])
    return balances


def scenario_with(**changes):
    base = {
        "scenario_name": "demo",
        "setup": {"msisdn": "9876543210"},
        "steps": [{"action": "click", "target": ".a", "value": None}, {"action": "click", "target": ".b", "value": None}],
        "assertion": {"target": ".st-key-receipt_balance", "expected_contains": "{pre_balance+50}"},
    }
    return {**base, **changes}


def test_a_matching_page_passes_and_records_evidence(fake_env):
    FakeClient.pages[".st-key-receipt_balance"] = "New balance: 150.00"
    result = runner.execute_scenario(scenario_with())
    assert result["status"] == "pass" and result["evidence_path"] == "evidence/demo.png"
    assert result["steps_completed"] == 2 and "150.00" in result["detail"]


def test_a_wrong_page_fails_with_expected_and_actual(fake_env):
    FakeClient.pages[".st-key-receipt_balance"] = "New balance: 200.00"
    result = runner.execute_scenario(scenario_with())
    assert result["status"] == "fail"
    assert "'150.00'" in result["detail"] and "200.00" in result["detail"] and result["evidence_path"]


def test_a_missing_element_fails_gracefully_with_a_failure_screenshot(fake_env):
    FakeClient.broken = {".b"}
    result = runner.execute_scenario(scenario_with())
    assert result["status"] == "fail"
    assert "step 2 failed" in result["detail"] and "selector not found: .b" in result["detail"]
    assert result["steps_completed"] == 1 and result["evidence_path"] == "evidence/demo_failure.png"


def test_api_check_catches_a_double_charge(fake_env, monkeypatch):
    FakeClient.pages[".st-key-receipt_balance"] = "New balance: 150.00"
    readings = iter([100.0, 200.0])  # before the run, then after: charged twice
    monkeypatch.setattr(runner, "fetch_balance", lambda msisdn: next(readings))
    result = runner.execute_scenario(scenario_with(api_check={"balance_equals": "{pre_balance+50}"}))
    assert result["status"] == "fail" and "double charge" in result["detail"]


def test_api_check_passes_when_the_api_agrees(fake_env, monkeypatch):
    FakeClient.pages[".st-key-receipt_balance"] = "New balance: 150.00"
    readings = iter([100.0, 150.0])
    monkeypatch.setattr(runner, "fetch_balance", lambda msisdn: next(readings))
    result = runner.execute_scenario(scenario_with(api_check={"balance_equals": "{pre_balance+50}"}))
    assert result["status"] == "pass" and "API balance 150.00 matches" in result["detail"]


def test_unreachable_services_fail_with_a_helpful_message(monkeypatch):
    monkeypatch.setattr(runner, "_preflight", lambda: "recharge UI not reachable at http://localhost:8501 (start it)")
    result = runner.execute_scenario(scenario_with())
    assert result["status"] == "fail" and "not reachable" in result["detail"]


def test_a_crash_starting_the_browser_never_escapes(fake_env, monkeypatch):
    class Boom(FakeClient):
        async def __aenter__(self):
            raise RuntimeError("npx not found")

    monkeypatch.setattr(runner, "MCPClient", Boom)
    result = runner.execute_scenario(scenario_with())
    assert result["status"] == "fail" and "npx not found" in result["detail"]


def test_execute_scenario_is_safe_inside_a_running_event_loop(fake_env):
    """The chat graph may call it from a thread that already runs an event loop."""
    import asyncio

    FakeClient.pages[".st-key-receipt_balance"] = "New balance: 150.00"

    async def caller():
        return runner.execute_scenario(scenario_with())

    assert asyncio.run(caller())["status"] == "pass"


def test_cli_rejects_unknown_scenario_names(capsys):
    assert runner.main(["no_such_scenario"]) == 2
    assert "unknown scenario" in capsys.readouterr().out
