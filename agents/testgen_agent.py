import json
import os

from agents.llm import get_llm
from agents.state import AgentState
from agents.utils import parse_json
from tests_qa.urls import is_allowed_navigation, recharge_ui_url

REQUIRED_KEYS = {"scenario_name", "target_page", "steps", "assertion"}
VALID_ACTIONS = {"navigate", "fill", "click", "select", "wait_for", "read_text"}
VALID_PAGES = {"recharge", "confirmation", "receipt"}
UI_URL = recharge_ui_url()
CUSTOMER_URL = UI_URL + "/customers/9876543210"

# The worked example is the happy-path scenario; a small model imitates a concrete example far more reliably
# than it follows an abstract schema.
_EXAMPLE = {
    "scenario_name": "valid_recharge_e2e",
    "target_page": "receipt",
    "steps": [
        {"action": "navigate", "target": CUSTOMER_URL, "value": None},
        {"action": "wait_for", "target": "Sign in to look up customers", "value": None},
        {"action": "fill", "target": "#name", "value": "QA Agent"},
        {"action": "click", "target": '[data-testid="login-submit"]', "value": None},
        {"action": "wait_for", "target": "Prepaid subscriber", "value": None},
        {"action": "click", "target": '[data-testid="open-recharge"]', "value": None},
        {"action": "wait_for", "target": "Add balance to", "value": None},
        {"action": "fill", "target": '[data-testid="recharge-amount"]', "value": "199"},
        {"action": "click", "target": '[data-testid="recharge-continue"]', "value": None},
        {"action": "wait_for", "target": "Confirm recharge", "value": None},
        {"action": "click", "target": '[data-testid="recharge-confirm"]', "value": None},
        {"action": "wait_for", "target": "Recharge successful", "value": None},
    ],
    "assertion": {"target": '[data-testid="receipt-balance"]', "expected_contains": "{pre_balance+199}"},
}

TESTGEN_PROMPT = (
    """Convert this plain-English QA requirement into a structured browser test scenario for a prepaid billing
console. Respond with ONE JSON object only, no commentary.

The app: a customer page (/customers/<10-digit number>) with a Recharge button that opens a dialog with 3 pages:
page "recharge" (amount, plan, Continue button) -> page "confirmation" (shows the amount, Back and Confirm recharge
buttons) -> page "receipt" (transaction id, new balance). The browser starts signed out: every scenario must first open
the customer page, sign in with the name field and the sign-in button (see the example), then click Recharge.

Allowed actions: navigate | fill | click | select | wait_for | read_text
- navigate: target = """
    + CUSTOMER_URL
    + """  (use the number the requirement names, default 9876543210)
- wait_for: target = text that must appear on the page (use it after every click that changes page)
- fill: target = a selector below, value = the text to type (typing never submits: click the button)
- click: target = a selector below
- select: target = the plan dropdown selector, value = PLAN_199 | PLAN_599 | PLAN_99

Selectors (use exactly these):
  name field (sign-in)  #name
  sign-in button        [data-testid="login-submit"]
  Recharge button       [data-testid="open-recharge"]
  amount field          [data-testid="recharge-amount"]
  plan dropdown         [data-testid="recharge-plan"]
  Continue button       [data-testid="recharge-continue"]
  Back button           [data-testid="recharge-back"]
  Confirm button        [data-testid="recharge-confirm"]
  amount error          [data-testid="recharge-amount-error"]   (text: "Use digits with at most 2 decimals, ...")
  confirmation amount   [data-testid="review-amount"]           (text like "₹599.00")
  receipt new balance   [data-testid="receipt-balance"]         (text like "₹244.50")
  receipt transaction   [data-testid="receipt-txn"]

Page texts for wait_for: "Sign in to look up customers" (sign-in page), "Prepaid subscriber" (customer page),
"Add balance to" (recharge page), "Confirm recharge" (confirmation page), "Recharge successful" (receipt page).
Amounts are shown with two decimals (599 -> "599.00").
For a balance after recharging N, expected_contains must be "{pre_balance+N}" (the previous balance plus N,
filled in at run time).

Schema:
{"scenario_name": "snake_case_name", "target_page": "recharge|confirmation|receipt",
 "steps": [{"action": "...", "target": "...", "value": "text or null"}],
 "assertion": {"target": "selector", "expected_contains": "text"}}

Example, for "Verify that recharging 199 updates the balance":
"""
    + json.dumps(_EXAMPLE, indent=1)
    + """

REQUIREMENT: <<REQUIREMENT>>
JSON:"""
)


def is_valid_scenario(scenario) -> bool:
    if not isinstance(scenario, dict) or not REQUIRED_KEYS <= scenario.keys():
        return False
    steps, assertion = scenario["steps"], scenario["assertion"]
    if not (isinstance(steps, list) and steps and scenario["target_page"] in VALID_PAGES):
        return False
    for step in steps:
        if not isinstance(step, dict) or step.get("action") not in VALID_ACTIONS:
            return False
        if not isinstance(step.get("target"), str) or not step["target"]:
            return False
        if step["action"] == "navigate" and not is_allowed_navigation(step["target"]):
            return False  # never let generated steps send the browser anywhere but the recharge app
        if step["action"] in {"fill", "select"} and not isinstance(step.get("value"), str):
            return False
    return isinstance(assertion, dict) and all(isinstance(assertion.get(k), str) and assertion[k] for k in ("target", "expected_contains"))


def generate_scenario(requirement: str):
    """Ask the LLM for a scenario; return it if it is well-formed, else None."""
    raw = get_llm().invoke(TESTGEN_PROMPT.replace("<<REQUIREMENT>>", requirement)).content
    scenario = parse_json(raw)
    return scenario if is_valid_scenario(scenario) else None


QA_DISABLED_MESSAGE = (
    "Browser test runs are only available in the local setup (they need Node.js, Playwright and the console "
    "running), so they are switched off in this deployment."
)


def testgen_node(state: AgentState) -> dict:
    if os.getenv("ENABLE_QA_RUNS", "1") == "0":
        return {"raw_answer": QA_DISABLED_MESSAGE}

    scenario = generate_scenario(state["query"])
    if scenario is None:
        return {
            "raw_answer": "I couldn't turn that into a runnable test scenario. Try rephrasing it more concretely."
        }

    # Imported lazily: the executor pulls in the MCP client, which chat-only paths don't need.
    from tests_qa.run_agent_tests import execute_scenario

    result = execute_scenario(scenario)
    verdict = "passed" if result["status"] == "pass" else "FAILED"
    return {
        "test_scenario": scenario,
        "test_result": result,
        "raw_answer": f"Test '{scenario['scenario_name']}' {verdict}. {result['detail']}",
    }
