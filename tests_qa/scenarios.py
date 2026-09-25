"""The five recharge-flow scenarios, as data.

Each scenario is the exact structure the Test-Gen agent produces (agents/testgen_agent.py) and the runner executes:

    scenario_name, target_page, steps[{action, target, value}], assertion{target, expected_contains}

plus, for scenarios that compare against the billing system:
    setup           {"msisdn": ...}  - the subscriber whose balance is read from the API before the run
    api_check       an expected balance the API must report after the run (cross-system verification)
    requirement     the plain-English request that would generate this scenario (used by --generate)

Expected values may use `{pre_balance+N}`: the subscriber's balance read live from GET /balance before the run, plus
N, formatted to two decimals. Nothing depends on the seed data, so scenarios can be re-run any number of times.

Selectors are the stable `.st-key-<key>` classes exposed by ui/recharge_app.py. Actions:
navigate | fill | click | select | wait_for (text) | read_text.
"""

UI = "http://localhost:8501"
MSISDN = "9876543210"

SEL = {
    "msisdn": ".st-key-msisdn_input input",
    "amount": ".st-key-amount_input input",
    "plan": ".st-key-plan_dropdown",
    "continue": ".st-key-continue_btn button",
    "back": ".st-key-back_btn button",
    "confirm": ".st-key-confirm_btn button",
    "error": ".st-key-error_message",
    "confirm_amount": ".st-key-confirm_amount_display",
    "receipt_balance": ".st-key-receipt_balance",
    "receipt_txn": ".st-key-receipt_txn_id",
}


def _open_form(msisdn: str, amount: str, plan: str | None = None) -> list[dict]:
    steps = [
        {"action": "navigate", "target": UI, "value": None},
        {"action": "wait_for", "target": "Mobile number", "value": None},
        {"action": "fill", "target": SEL["msisdn"], "value": msisdn},
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
            {"action": "wait_for", "target": "Confirm your recharge", "value": None},
            {"action": "click", "target": SEL["confirm"], "value": None},
            {"action": "wait_for", "target": "Recharge successful", "value": None},
            {"action": "read_text", "target": SEL["receipt_txn"], "value": None},
        ],
        "assertion": {"target": SEL["receipt_balance"], "expected_contains": "{pre_balance+199}"},
    },
    {
        "scenario_name": "invalid_msisdn_rejected",
        "requirement": "Verify that entering an invalid mobile number like 123 on the recharge page is rejected with "
        "a clear error message.",
        "target_page": "recharge",
        "steps": _open_form("123", "199")
        + [
            {"action": "click", "target": SEL["continue"], "value": None},
            {"action": "wait_for", "target": "Enter a valid 10-digit number", "value": None},
        ],
        "assertion": {"target": SEL["error"], "expected_contains": "Enter a valid 10-digit number"},
    },
    {
        "scenario_name": "confirmation_amount_matches",
        "requirement": "Verify that the confirmation page shows exactly the amount 599 that was entered on the "
        "recharge page.",
        "target_page": "confirmation",
        "steps": _open_form(MSISDN, "599")
        + [
            {"action": "click", "target": SEL["continue"], "value": None},
            {"action": "wait_for", "target": "Confirm your recharge", "value": None},
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
            {"action": "wait_for", "target": "Confirm your recharge", "value": None},
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
            {"action": "wait_for", "target": "Confirm your recharge", "value": None},
            {"action": "click", "target": SEL["back"], "value": None},
            {"action": "wait_for", "target": "Mobile number", "value": None},
            {"action": "click", "target": SEL["continue"], "value": None},
            {"action": "wait_for", "target": "Confirm your recharge", "value": None},
            {"action": "click", "target": SEL["confirm"], "value": None},
            {"action": "wait_for", "target": "Recharge successful", "value": None},
        ],
        "assertion": {"target": SEL["receipt_balance"], "expected_contains": "{pre_balance+99}"},
        "api_check": {"balance_equals": "{pre_balance+99}"},
    },
]

BY_NAME = {s["scenario_name"]: s for s in SCENARIOS}
