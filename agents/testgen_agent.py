import json

from agents.llm import get_llm
from agents.state import AgentState
from agents.utils import parse_json

REQUIRED_KEYS = {"scenario_name", "target_page", "steps", "assertion"}
VALID_ACTIONS = {"navigate", "fill", "click", "select", "wait_for", "read_text"}
VALID_PAGES = {"recharge", "confirmation", "receipt"}
UI_URL = "http://localhost:8501"

# The worked example is the happy-path scenario; a small model imitates a concrete example far more reliably
# than it follows an abstract schema.
_EXAMPLE = {
    "scenario_name": "valid_recharge_e2e",
    "target_page": "receipt",
    "steps": [
        {"action": "navigate", "target": UI_URL, "value": None},
        {"action": "wait_for", "target": "Mobile number", "value": None},
        {"action": "fill", "target": ".st-key-msisdn_input input", "value": "9876543210"},
        {"action": "fill", "target": ".st-key-amount_input input", "value": "199"},
        {"action": "click", "target": ".st-key-continue_btn button", "value": None},
        {"action": "wait_for", "target": "Confirm your recharge", "value": None},
        {"action": "click", "target": ".st-key-confirm_btn button", "value": None},
        {"action": "wait_for", "target": "Recharge successful", "value": None},
    ],
    "assertion": {"target": ".st-key-receipt_balance", "expected_contains": "{pre_balance+199}"},
}

TESTGEN_PROMPT = (
    """Convert this plain-English QA requirement into a structured browser test scenario for a 3-page
prepaid recharge web app. Respond with ONE JSON object only, no commentary.

The app: page "recharge" (mobile number, amount, plan, Continue button) -> page "confirmation" (shows the entered
details, Back and Confirm buttons) -> page "receipt" (transaction id, new balance).

Allowed actions: navigate | fill | click | select | wait_for | read_text
- navigate: target = """
    + UI_URL
    + """
- wait_for: target = text that must appear on the page (use it after every click that changes page)
- fill: target = a selector below, value = the text to type
- click: target = a selector below
- select: target = the plan dropdown selector, value = PLAN_199 | PLAN_599 | PLAN_99

Selectors (use exactly these):
  mobile number field   .st-key-msisdn_input input
  amount field          .st-key-amount_input input
  plan dropdown         .st-key-plan_dropdown
  Continue button       .st-key-continue_btn button
  Back button           .st-key-back_btn button
  Confirm button        .st-key-confirm_btn button
  error message         .st-key-error_message          (text: "Enter a valid 10-digit number")
  confirmation amount   .st-key-confirm_amount_display (text like "Amount: 599.00")
  receipt new balance   .st-key-receipt_balance        (text like "New balance: 244.50")
  receipt transaction   .st-key-receipt_txn_id

Page texts for wait_for: "Mobile number" (recharge page), "Confirm your recharge" (confirmation page),
"Recharge successful" (receipt page). Amounts are shown with two decimals (599 -> "599.00").
For a balance after recharging N, expected_contains must be "{pre_balance+N}" (the previous balance plus N,
filled in at run time). Use 9876543210 as the mobile number unless the requirement names another.

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
        if step["action"] in {"fill", "select"} and not isinstance(step.get("value"), str):
            return False
    return isinstance(assertion, dict) and all(isinstance(assertion.get(k), str) and assertion[k] for k in ("target", "expected_contains"))


def generate_scenario(requirement: str):
    """Ask the LLM for a scenario; return it if it is well-formed, else None."""
    raw = get_llm().invoke(TESTGEN_PROMPT.replace("<<REQUIREMENT>>", requirement)).content
    scenario = parse_json(raw)
    return scenario if is_valid_scenario(scenario) else None


def testgen_node(state: AgentState) -> dict:
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
