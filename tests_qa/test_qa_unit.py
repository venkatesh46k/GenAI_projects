"""Offline tests for the QA agent: no browser, no Node, no running services (the MCP client is faked)."""
import sys

import pytest

from agents.testgen_agent import TESTGEN_PROMPT, is_valid_scenario
from tests_qa import run_agent_tests as runner
from tests_qa.mcp_client import StepFailure, _selector_problem, extract_text
from tests_qa.scenarios import BY_NAME, SCENARIOS, SEL

# ---------- extract_text: real Playwright MCP snapshot shapes ----------

SNAPSHOT = """### Page
- Page URL: http://localhost:8080/
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
    scenario = {"steps": [{"action": "navigate", "target": "http://localhost:8080/customers/9123456780", "value": None}]}
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
    monkeypatch.setattr(runner, "_preflight", lambda: "recharge UI not reachable at http://localhost:8080 (start it)")
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


# ---------- asyncio policy: the bug that made browser tests fail inside Streamlit on Windows ----------

async def _spawn_child():
    import asyncio
    import sys

    proc = await asyncio.create_subprocess_exec(sys.executable, "-c", "print('child ok')", stdout=asyncio.subprocess.PIPE)
    out, _ = await proc.communicate()
    return out.decode().strip()


@pytest.mark.skipif(sys.platform != "win32", reason="Selector loops only lack subprocess support on Windows")
def test_subprocesses_work_even_under_streamlits_selector_policy():
    """Streamlit's server sets WindowsSelectorEventLoopPolicy; asyncio.run() then cannot spawn the MCP server."""
    import asyncio

    previous = asyncio.get_event_loop_policy()
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    try:
        with pytest.raises(NotImplementedError):  # the failure being guarded against, reproduced in a thread
            runner.concurrent.futures.ThreadPoolExecutor(1).submit(asyncio.run, _spawn_child()).result()
        assert runner.run_in_fresh_loop(_spawn_child) == "child ok"  # the fix
    finally:
        asyncio.set_event_loop_policy(previous)


def test_run_in_fresh_loop_returns_the_coroutine_result_and_propagates_errors():
    async def ok():
        return 42

    async def boom():
        raise ValueError("nope")

    assert runner.run_in_fresh_loop(ok) == 42
    with pytest.raises(ValueError, match="nope"):
        runner.run_in_fresh_loop(boom)


def test_every_run_uses_an_isolated_browser_profile_so_runs_can_overlap():
    from tests_qa.mcp_client import MCPClient

    args = MCPClient().server_args()
    assert "--isolated" in args and "--headless" in args and not any(a.startswith("--timeout-action") for a in args)
    assert "--headless" not in MCPClient(headless=False).server_args()
    assert "--timeout-action=600000" in MCPClient(action_timeout_ms=600_000).server_args()


# ---------- navigation allowlist: generated steps must not steer the browser anywhere else ----------

from tests_qa.urls import is_allowed_navigation  # noqa: E402


@pytest.mark.parametrize(
    "url,allowed",
    [
        ("http://localhost:8080", True),
        ("http://localhost:8080/", True),
        ("http://127.0.0.1:8080/?x=1", True),  # loopback names are the same host
        ("http://localhost:8080/some/page", True),
        ("http://evil.example/", False),
        ("https://localhost:8080", False),  # different scheme
        ("http://localhost:9999", False),  # different port: another local service
        ("http://localhost.evil.example:8080", False),
        ("http://localhost:8080@evil.example/", False),  # userinfo trick: the real host is evil.example
        ("file:///C:/Users/secrets.txt", False),
        ("javascript:alert(1)", False),
        ("about:blank", False),
        ("", False),
    ],
)
def test_navigation_is_limited_to_the_recharge_app(monkeypatch, url, allowed):
    monkeypatch.delenv("RECHARGE_UI_URL", raising=False)
    assert is_allowed_navigation(url) is allowed


def test_the_allowed_origin_follows_the_configured_url(monkeypatch):
    monkeypatch.setenv("RECHARGE_UI_URL", "http://127.0.0.1:9000")
    assert is_allowed_navigation("http://localhost:9000") and not is_allowed_navigation("http://localhost:8080")


def test_the_validator_rejects_a_generated_scenario_that_navigates_elsewhere():
    scenario = {
        "scenario_name": "injected",
        "target_page": "recharge",
        "steps": [{"action": "navigate", "target": "http://attacker.example/", "value": None}],
        "assertion": {"target": ".a", "expected_contains": "b"},
    }
    assert is_valid_scenario(scenario) is False
    scenario["steps"][0]["target"] = "http://localhost:8080"
    assert is_valid_scenario(scenario) is True


def test_the_runner_refuses_a_bad_navigation_even_if_validation_was_bypassed(monkeypatch):
    monkeypatch.setattr(runner, "_preflight", lambda: None)  # even with both services up
    result = runner.execute_scenario(
        {
            "scenario_name": "sneaky",
            "steps": [{"action": "navigate", "target": "file:///C:/Windows/win.ini", "value": None}],
            "assertion": {"target": ".a", "expected_contains": "b"},
        }
    )
    assert result["status"] == "fail" and "not allowed" in result["detail"]


def test_amounts_match_with_or_without_thousands_grouping():
    assert runner.contains("₹244.50", "244.50")
    assert runner.contains("₹1,234.50", "1234.50")  # the console groups thousands; the expected value does not
    assert runner.contains("₹1,234.50", "1,234.50")
    assert not runner.contains("₹1,234.50", "1234.51")
