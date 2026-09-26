"""The five recharge-flow scenarios, as data.

Each scenario is the exact structure the Test-Gen agent produces (agents/testgen_agent.py) and the runner executes:

    scenario_name, target_page, steps[{action, target, value}], assertion{target, expected_contains}

plus, for scenarios that compare against the billing system:
    setup           {"msisdn": ...}  - the subscriber whose balance is read from the API before the run
    api_check       an expected balance the API must report after the run (cross-system verification)
    requirement     the plain-English request that would generate this scenario (used by --generate)

Expected values may use `{pre_balance+N}`: the subscriber's balance read live from GET /balance before the run, plus
N, formatted to two decimals. Nothing depends on the seed data, so scenarios can be re-run any number of times.

The target is the React console. Every browser run starts signed out, so each scenario opens the customer's page, signs
in with the demo login (which returns to that page) and opens the Recharge dialog: details -> review -> receipt.
Selectors are the console's `data-testid` attributes. Actions: navigate | fill | click | select | wait_for | read_text.
"""
from tests_qa.urls import recharge_ui_url

UI = recharge_ui_url()
MSISDN = "9876543210"


def _tid(name: str) -> str:
    return f'[data-testid="{name}"]'


SEL = {
    "login_name": "#name",
    "login_submit": _tid("login-submit"),
    "open_recharge": _tid("open-recharge"),
    "amount": _tid("recharge-amount"),
    "plan": _tid("recharge-plan"),
    "continue": _tid("recharge-continue"),
    "back": _tid("recharge-back"),
    "confirm": _tid("recharge-confirm"),
    "error": _tid("recharge-amount-error"),
    "confirm_amount": _tid("review-amount"),
    "receipt_balance": _tid("receipt-balance"),
    "receipt_txn": _tid("receipt-txn"),
}


def _open_form(msisdn: str, amount: str, plan: str | None = None) -> list[dict]:
    """Sign in, open the customer, open the Recharge dialog and fill in the details step."""
    steps = [
        {"action": "navigate", "target": f"{UI}/customers/{msisdn}", "value": None},
        {"action": "wait_for", "target": "Sign in to look up customers", "value": None},
        {"action": "fill", "target": SEL["login_name"], "value": "QA Agent"},
        {"action": "click", "target": SEL["login_submit"], "value": None},
        {"action": "wait_for", "target": "Prepaid subscriber", "value": None},
        {"action": "click", "target": SEL["open_recharge"], "value": None},
        {"action": "wait_for", "target": "Add balance to", "value": None},
        {"action": "fill", "target": SEL["amount"], "value": amount},
    ]
    if plan:
        steps.append({"action": "select", "target": SEL["plan"], "value": plan})
    return steps


SCENARIOS = [
    {
        "scenario_name": "valid_recharge_e2e",
        "requirement": "Verify that recharging 9876543210 with 199 on the recharge flow shows the correct new balance "
        "on the receipt page.",
        "target_page": "receipt",
        "setup": {"msisdn": MSISDN},
        "steps": _open_form(MSISDN, "199", "PLAN_199")
        + [
            {"action": "click", "target": SEL["continue"], "value": None},
            {"action": "wait_for", "target": "Confirm recharge", "value": None},
            {"action": "click", "target": SEL["confirm"], "value": None},
            {"action": "wait_for", "target": "Recharge successful", "value": None},
            {"action": "read_text", "target": SEL["receipt_txn"], "value": None},
        ],
        "assertion": {"target": SEL["receipt_balance"], "expected_contains": "{pre_balance+199}"},
    },
    {
        "scenario_name": "invalid_amount_rejected",
        "requirement": "Verify that entering an invalid amount like abc on the recharge page is rejected with a clear "
        "error message.",
        "target_page": "recharge",
        "steps": _open_form(MSISDN, "abc")
        + [
            {"action": "click", "target": SEL["continue"], "value": None},
            {"action": "wait_for", "target": "Use digits with at most 2 decimals", "value": None},
        ],
        "assertion": {"target": SEL["error"], "expected_contains": "Use digits with at most 2 decimals"},
    },
    {
        "scenario_name": "confirmation_amount_matches",
        "requirement": "Verify that the confirmation page shows exactly the amount 599 that was entered on the "
        "recharge page.",
        "target_page": "confirmation",
        "steps": _open_form(MSISDN, "599")
        + [
            {"action": "click", "target": SEL["continue"], "value": None},
            {"action": "wait_for", "target": "Confirm recharge", "value": None},
        ],
        "assertion": {"target": SEL["confirm_amount"], "expected_contains": "599.00"},
    },
    {
        "scenario_name": "receipt_balance_matches_api",
        "requirement": "Verify that the balance on the receipt page after recharging 99 equals the previous balance "
        "plus 99, and that the billing API reports the same balance.",
        "target_page": "receipt",
        "setup": {"msisdn": MSISDN},
        "steps": _open_form(MSISDN, "99")
        + [
            {"action": "click", "target": SEL["continue"], "value": None},
            {"action": "wait_for", "target": "Confirm recharge", "value": None},
            {"action": "click", "target": SEL["confirm"], "value": None},
            {"action": "wait_for", "target": "Recharge successful", "value": None},
        ],
        "assertion": {"target": SEL["receipt_balance"], "expected_contains": "{pre_balance+99}"},
        "api_check": {"balance_equals": "{pre_balance+99}"},
    },
    {
        "scenario_name": "back_nav_no_double_charge",
        "requirement": "Verify that going Back from the confirmation page and continuing again does not charge the "
        "subscriber twice: the balance goes up by 99 exactly once.",
        "target_page": "receipt",
        "setup": {"msisdn": MSISDN},
        "steps": _open_form(MSISDN, "99")
        + [
            {"action": "click", "target": SEL["continue"], "value": None},
            {"action": "wait_for", "target": "Confirm recharge", "value": None},
            {"action": "click", "target": SEL["back"], "value": None},
            {"action": "wait_for", "target": "Add balance to", "value": None},
            {"action": "click", "target": SEL["continue"], "value": None},
            {"action": "wait_for", "target": "Confirm recharge", "value": None},
            {"action": "click", "target": SEL["confirm"], "value": None},
            {"action": "wait_for", "target": "Recharge successful", "value": None},
        ],
        "assertion": {"target": SEL["receipt_balance"], "expected_contains": "{pre_balance+99}"},
        "api_check": {"balance_equals": "{pre_balance+99}"},
    },
]

BY_NAME = {s["scenario_name"]: s for s in SCENARIOS}
