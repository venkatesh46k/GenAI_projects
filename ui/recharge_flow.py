"""The 3-page recharge flow (recharge -> confirmation -> receipt), shared by the standalone app and the console.

Every element the QA agent touches has a `key`, which Streamlit exposes as a stable CSS class `st-key-<key>`
(`.st-key-continue_btn button`, `.st-key-receipt_balance`, ...). The keys and the visible texts asserted by
tests_qa/scenarios.py ("Mobile number", "Confirm your recharge", "Recharge successful", "Enter a valid 10-digit
number") are a contract: change them and the scenarios must change too.
"""
from datetime import datetime

import streamlit as st

from ui import api_client

PLANS = ["PLAN_199", "PLAN_599", "PLAN_99"]


def init_state() -> None:
    st.session_state.setdefault("page", "recharge")
    st.session_state.setdefault("form", {})
    st.session_state.setdefault("receipt", None)
    st.session_state.setdefault("error", None)


def reset_flow() -> None:
    """Back to a blank first page (used when the console switches to another customer)."""
    for key in ("form", "receipt", "error"):
        st.session_state.pop(key, None)
    st.session_state.page = "recharge"
    for key in ("msisdn_input", "amount_input", "plan_dropdown"):
        st.session_state.pop(key, None)


def _go(page: str) -> None:
    st.session_state.page = page
    st.session_state.error = None


def _on_continue() -> None:
    msisdn = st.session_state.msisdn_input.strip()
    amount = float(st.session_state.amount_input)
    if not (msisdn.isdigit() and len(msisdn) == 10):
        st.session_state.error = "Enter a valid 10-digit number"
    elif amount <= 0:
        st.session_state.error = "Enter an amount greater than zero"
    else:
        st.session_state.form = {"msisdn": msisdn, "amount": amount, "plan": st.session_state.plan_dropdown}
        _go("confirmation")


def _on_confirm() -> None:
    # A receipt already exists for this flow: never post a second recharge (double-click / rerun safety).
    if st.session_state.receipt is not None:
        _go("receipt")
        return
    form = st.session_state.form
    try:
        receipt = api_client.recharge(form["msisdn"], form["amount"], form["plan"])
    except api_client.ApiError as exc:
        st.session_state.error = str(exc)
        return
    st.session_state.receipt = {**receipt, "timestamp": datetime.now().isoformat(timespec="seconds")}
    _go("receipt")


def _on_back() -> None:
    _go("recharge")


def _on_done() -> None:
    st.session_state.form = {}
    st.session_state.receipt = None
    _go("recharge")


def _show_error() -> None:
    if st.session_state.error:
        with st.container(key="error_message"):
            st.error(st.session_state.error)


def render(prefill_msisdn: str = "") -> None:
    """Draw the current page of the flow. `prefill_msisdn` seeds the number field on a fresh first page."""
    init_state()
    page, form = st.session_state.page, st.session_state.form

    if page == "recharge":
        st.text_input("Mobile number", value=form.get("msisdn", prefill_msisdn), key="msisdn_input")
        st.number_input("Amount", min_value=0.0, step=1.0, value=float(form.get("amount", 0.0)), key="amount_input")
        st.selectbox(
            "Plan", PLANS, index=PLANS.index(form["plan"]) if form.get("plan") in PLANS else 0, key="plan_dropdown"
        )
        _show_error()
        st.button("Continue", key="continue_btn", on_click=_on_continue)

    elif page == "confirmation":
        st.subheader("Confirm your recharge")
        with st.container(key="confirm_msisdn_display"):
            st.write(f"Number: {form['msisdn']}")
        with st.container(key="confirm_amount_display"):
            st.write(f"Amount: {form['amount']:.2f}")
        with st.container(key="confirm_plan_display"):
            st.write(f"Plan: {form['plan']}")
        _show_error()
        back, confirm = st.columns(2)
        back.button("Back", key="back_btn", on_click=_on_back)
        confirm.button("Confirm", key="confirm_btn", on_click=_on_confirm)

    elif page == "receipt":
        receipt = st.session_state.receipt
        st.success("Recharge successful!")
        with st.container(key="receipt_txn_id"):
            st.write(f"Transaction ID: {receipt['txn_id']}")
        with st.container(key="receipt_balance"):
            st.write(f"New balance: {receipt['new_balance']:.2f}")
        with st.container(key="receipt_timestamp"):
            st.write(f"Timestamp: {receipt['timestamp']}")
        st.button("Done", key="done_btn", on_click=_on_done)
