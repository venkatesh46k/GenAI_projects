"""Mock 3-page recharge flow: the target of the Playwright MCP test agent.

    Page 1 (recharge)      mobile number, amount, plan, Continue
    Page 2 (confirmation)  the entered details, Back / Confirm
    Page 3 (receipt)       transaction id, new balance, timestamp, Done

Every element the tests touch has a `key`, which Streamlit exposes as a stable CSS class `st-key-<key>` on the
widget's container (e.g. `.st-key-continue_btn button`, `.st-key-receipt_balance`). The tests use those, not
Streamlit's generated ids, which change between runs.

Run:  streamlit run ui/recharge_app.py --server.port 8501   (the billing API must be running on FASTAPI_BASE_URL)
"""
import os
from datetime import datetime

import requests
import streamlit as st

API_BASE = os.getenv("FASTAPI_BASE_URL", "http://localhost:8000")
PLANS = ["PLAN_199", "PLAN_599", "PLAN_99"]

st.set_page_config(page_title="Recharge", page_icon="\U0001F4F1")

st.session_state.setdefault("page", "recharge")
st.session_state.setdefault("form", {})
st.session_state.setdefault("receipt", None)
st.session_state.setdefault("error", None)


def go(page: str) -> None:
    st.session_state.page = page
    st.session_state.error = None


def on_continue() -> None:
    msisdn = st.session_state.msisdn_input.strip()
    amount = float(st.session_state.amount_input)
    if not (msisdn.isdigit() and len(msisdn) == 10):
        st.session_state.error = "Enter a valid 10-digit number"
    elif amount <= 0:
        st.session_state.error = "Enter an amount greater than zero"
    else:
        st.session_state.form = {"msisdn": msisdn, "amount": amount, "plan": st.session_state.plan_dropdown}
        go("confirmation")


def on_confirm() -> None:
    # A receipt already exists for this flow: never post a second recharge (double-click / rerun safety).
    if st.session_state.receipt is not None:
        go("receipt")
        return
    f = st.session_state.form
    try:
        resp = requests.post(
            f"{API_BASE}/recharge",
            json={"msisdn": f["msisdn"], "amount": f["amount"], "plan_id": f["plan"]},
            timeout=10,
        )
    except requests.exceptions.RequestException:
        st.session_state.error = "The billing system is temporarily unavailable. Please try again."
        return
    if resp.status_code == 404:
        st.session_state.error = "No subscriber found for this number"
        return
    if not resp.ok:
        st.session_state.error = "The recharge could not be completed"
        return
    st.session_state.receipt = {**resp.json(), "timestamp": datetime.now().isoformat(timespec="seconds")}
    go("receipt")


def on_back() -> None:
    go("recharge")


def on_done() -> None:
    st.session_state.form = {}
    st.session_state.receipt = None
    go("recharge")


def show_error() -> None:
    if st.session_state.error:
        with st.container(key="error_message"):
            st.error(st.session_state.error)


st.title("Recharge")
page = st.session_state.page
form = st.session_state.form

if page == "recharge":
    st.text_input("Mobile number", value=form.get("msisdn", ""), key="msisdn_input")
    st.number_input("Amount", min_value=0.0, step=1.0, value=float(form.get("amount", 0.0)), key="amount_input")
    st.selectbox(
        "Plan", PLANS, index=PLANS.index(form["plan"]) if form.get("plan") in PLANS else 0, key="plan_dropdown"
    )
    show_error()
    st.button("Continue", key="continue_btn", on_click=on_continue)

elif page == "confirmation":
    st.subheader("Confirm your recharge")
    with st.container(key="confirm_msisdn_display"):
        st.write(f"Number: {form['msisdn']}")
    with st.container(key="confirm_amount_display"):
        st.write(f"Amount: {form['amount']:.2f}")
    with st.container(key="confirm_plan_display"):
        st.write(f"Plan: {form['plan']}")
    show_error()
    back, confirm = st.columns(2)
    back.button("Back", key="back_btn", on_click=on_back)
    confirm.button("Confirm", key="confirm_btn", on_click=on_confirm)

elif page == "receipt":
    receipt = st.session_state.receipt
    st.success("Recharge successful!")
    with st.container(key="receipt_txn_id"):
        st.write(f"Transaction ID: {receipt['txn_id']}")
    with st.container(key="receipt_balance"):
        st.write(f"New balance: {receipt['new_balance']:.2f}")
    with st.container(key="receipt_timestamp"):
        st.write(f"Timestamp: {receipt['timestamp']}")
    st.button("Done", key="done_btn", on_click=on_done)
