"""Billing Ops Console: a CRM-style workspace for a support agent.

    Customer 360   profile, balance, usage (CDRs), transactions, disputes, escalate
    Recharge       the 3-page recharge flow for the selected customer
    Copilot        the multi-agent assistant (RAG, billing, disputes, escalation, QA runs) with the selected
                   customer as context

    streamlit run ui/chat_app.py      (the billing API must be running on FASTAPI_BASE_URL)
"""
import logging
import os
import sys
import threading

import streamlit as st

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))  # `ui` and `agents` imports under `streamlit run`

from dotenv import load_dotenv  # noqa: E402

load_dotenv()

from ui import api_client, console_data as cd, recharge_flow  # noqa: E402

log = logging.getLogger("console")
NAV = ["Customer 360", "Recharge", "Copilot"]

st.set_page_config(page_title="Billing Ops Console", page_icon="\U0001F4E1", layout="wide")

st.markdown(
    """
    <style>
      /* the fixed Streamlit header is ~60px tall: without this the page title sits underneath it */
      .block-container {padding-top: 4.5rem; padding-bottom: 2rem; max-width: 1200px;}
      [data-testid="stMetric"] {background:#fff; border:1px solid #e3e7ee; border-radius:12px; padding:14px 18px;}
      [data-testid="stMetricLabel"] {color:#5f6b7a;}
      /* long values such as "Premium 599" must wrap instead of being cut off with an ellipsis */
      [data-testid="stMetricValue"] {font-size:1.7rem;}
      [data-testid="stMetricValue"] > div {white-space:normal; overflow:visible; text-overflow:clip;}
      .ops-title {font-size:1.5rem; font-weight:700; margin:0;}
      .ops-sub {color:#5f6b7a; margin:0 0 .75rem 0;}
      .ops-brand {font-weight:700; font-size:1.15rem; margin-bottom:.1rem;}
    </style>
    """,
    unsafe_allow_html=True,
)


# ---------------------------------------------------------------- data

@st.cache_resource
def start_warmup() -> threading.Thread:
    """Load the agent graph and the vector store in the background, once per server process.

    The first Copilot question otherwise pays for importing the ML libraries and loading the embedding model, which
    takes minutes on a small machine. Starting it as soon as the console opens hides most of that wait.
    """

    def load() -> None:
        try:
            from agents.graph import app  # noqa: F401
            from rag.retriever import cached_retriever

            cached_retriever()
        except Exception:
            log.exception("model warm-up failed (the first question will retry)")

    thread = threading.Thread(target=load, name="copilot-warmup", daemon=True)
    thread.start()
    return thread


def load_customers() -> list[dict]:
    try:
        return api_client.list_subscribers()
    except api_client.ApiError as exc:
        st.error(f"{exc} The console needs the billing API (uvicorn mock_api.main:app --port 8000).")
        st.stop()


def go(view: str) -> None:
    st.session_state.nav = view


# ---------------------------------------------------------------- views

def view_customer_360(customer: dict) -> None:
    msisdn = customer["msisdn"]
    try:
        balance = api_client.get_balance(msisdn)
        plan = api_client.get_plan(balance["plan_id"]) if balance.get("plan_id") else None
        cdrs = api_client.get_cdrs(msisdn, limit=20)
        transactions = api_client.get_transactions(msisdn, limit=20)
        disputes = api_client.get_disputes(msisdn)
    except api_client.ApiError as exc:
        st.error(str(exc))
        return

    st.markdown(
        f'<p class="ops-title">{msisdn} &nbsp;{cd.status_badge_html(balance["status"])}</p>'
        f'<p class="ops-sub">Prepaid subscriber &middot; last recharge {cd.fmt_ts(customer.get("last_recharge_date"))}</p>',
        unsafe_allow_html=True,
    )
    if warning := cd.balance_warning(balance["balance"], balance["status"]):
        st.warning(warning)

    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Balance", cd.money(balance["balance"]))
    c2.metric("Plan", plan["name"] if plan else "None")
    c3.metric("Plan price", cd.money(plan["price"]) if plan else "-")
    c4.metric("Validity", f"{plan['validity_days']} days" if plan else "-")
    if plan:
        st.caption(
            f"{plan['data_per_day_gb']} GB/day · {plan['voice_minutes']} voice minutes · {plan['sms_per_day']} SMS/day"
        )

    a1, a2, _ = st.columns([1, 1, 4])
    a1.button("Recharge", key="qa_recharge", type="primary", on_click=go, args=("Recharge",), use_container_width=True)
    a2.button("Ask Copilot", key="qa_copilot", on_click=go, args=("Copilot",), use_container_width=True)

    usage_tab, txn_tab, dispute_tab = st.tabs(
        [f"Usage ({len(cdrs)})", f"Transactions ({len(transactions)})", f"Disputes ({len(disputes)})"]
    )
    with usage_tab:
        if cdrs:
            st.dataframe(cd.cdr_frame(cdrs), hide_index=True, use_container_width=True)
        else:
            st.info("No usage records.")
    with txn_tab:
        if transactions:
            st.dataframe(cd.transaction_frame(transactions), hide_index=True, use_container_width=True)
        else:
            st.info("No transactions yet. Recharges made here or through the Copilot appear in this list.")
    with dispute_tab:
        if not disputes:
            st.info("No disputes for this customer.")
            return
        st.dataframe(cd.dispute_frame(disputes), hide_index=True, use_container_width=True)
        open_ids = [d["dispute_id"] for d in disputes if d["status"] == "open"]
        if open_ids:
            with st.expander("Escalate a dispute to a specialist"):
                chosen = st.selectbox("Open dispute", open_ids, key="escalate_choice")
                if st.button("Escalate", key="escalate_btn"):
                    try:
                        result = api_client.escalate(chosen)
                    except api_client.ApiError as exc:
                        st.error(str(exc))
                    else:
                        st.success(f"Escalated. Ticket {result['ticket_id']}. Resolution target: 10 working days.")
                        st.rerun()


def view_recharge(customer: dict) -> None:
    msisdn = customer["msisdn"]
    st.markdown(f'<p class="ops-title">Recharge</p><p class="ops-sub">Add balance to {msisdn}</p>', unsafe_allow_html=True)
    if st.session_state.get("recharge_for") != msisdn:  # another customer: start from a blank first page
        recharge_flow.reset_flow()
        st.session_state.recharge_for = msisdn
    with st.container(border=True):
        recharge_flow.render(prefill_msisdn=msisdn)


def ask_copilot(query: str, msisdn: str | None) -> dict:
    from agents.graph import app  # heavy import (models, vector store): only when the Copilot is first used

    return app.invoke({"query": query, "msisdn": msisdn})


def render_assistant_details(meta: dict) -> None:
    result = meta.get("test_result")
    if result:
        (st.success if result["status"] == "pass" else st.error)(f"Browser test {result['status'].upper()}")
        evidence = result.get("evidence_path")
        if evidence and os.path.exists(evidence):
            st.image(evidence, caption="Test evidence")
    with st.expander("How this was answered"):
        st.write(f"**Handled by:** {meta.get('route_label') or 'n/a'}")
        if meta.get("pii_masked"):
            st.write("**Privacy:** phone numbers in the reply were masked.")
        if meta.get("safety_flag"):
            st.write(f"**Safety check:** flagged as {meta['safety_flag']}.")
        if meta.get("tool_calls"):
            st.write("**Billing system calls:**")
            st.json(meta["tool_calls"])
        if meta.get("sources"):
            st.write("**Knowledge-base passages used:**")
            for passage in meta["sources"][:3]:
                st.caption(passage[:300].replace("\n", " "))


def view_copilot(customer: dict) -> None:
    st.markdown(
        '<p class="ops-title">Copilot</p><p class="ops-sub">Ask about policies, balances, disputes, or ask it to '
        "verify a flow in a real browser.</p>",
        unsafe_allow_html=True,
    )
    if problem := os.getenv("DEPLOY_LLM_PROBLEM"):  # set by deploy/app.py when the hosted LLM is not configured
        st.warning(problem)
        return
    use_customer = st.toggle(f"Use {customer['msisdn']} as context", value=True, key="use_customer")
    chat = st.session_state.setdefault("chat", [])

    if not chat:
        st.caption("Try one of these:")
        cols = st.columns(2)
        for i, prompt in enumerate(cd.SUGGESTED_PROMPTS):
            cols[i % 2].button(prompt, key=f"suggest_{i}", use_container_width=True,
                               on_click=st.session_state.__setitem__, args=("pending_query", prompt))

    for message in chat:
        with st.chat_message(message["role"]):
            st.markdown(message["content"])
            if message["role"] == "assistant":
                render_assistant_details(message["meta"])

    query = st.session_state.pop("pending_query", None) or st.chat_input("Ask the Copilot...")
    if not query:
        return

    chat.append({"role": "user", "content": query})
    with st.chat_message("user"):
        st.markdown(query)
    with st.chat_message("assistant"):
        try:
            with st.spinner("Working on it (the first question loads the models)..."):
                result = ask_copilot(query, customer["msisdn"] if use_customer else None)
            answer = result.get("moderated_answer") or "Sorry, I could not produce an answer."
            meta = {
                "route_label": cd.route_label(result),
                "pii_masked": result.get("pii_masked"),
                "safety_flag": result.get("safety_flag"),
                "tool_calls": result.get("tool_calls"),
                "sources": result.get("retrieved_context"),
                "test_result": result.get("test_result"),
            }
        except Exception:  # never show a stack trace to an agent mid-call
            log.exception("copilot failed")
            answer, meta = "Sorry, the assistant ran into a problem. Please try again.", {}
        st.markdown(answer)
        render_assistant_details(meta)
    chat.append({"role": "assistant", "content": answer, "meta": meta})


# ---------------------------------------------------------------- shell

customers = load_customers()
if os.getenv("CONSOLE_WARMUP", "1") == "1" and not os.getenv("DEPLOY_LLM_PROBLEM"):
    start_warmup()
by_number = {c["msisdn"]: c for c in customers}

with st.sidebar:
    st.markdown('<p class="ops-brand">Billing Ops Console</p>', unsafe_allow_html=True)
    st.caption("Prepaid billing copilot")
    selected = st.selectbox(
        "Customer",
        list(by_number),
        format_func=lambda m: cd.customer_option(by_number[m]),
        key="customer",
    )
    st.session_state.setdefault("nav", NAV[0])
    st.radio("Workspace", NAV, key="nav")
    st.divider()
    try:
        from agents.llm import get_model_name, resolve_provider

        provider = resolve_provider()
        st.caption(f"Assistant model: {provider} · {get_model_name(provider)}")
    except Exception:
        st.caption("Assistant model: not configured")
    st.caption(f"Billing API: connected · {len(customers)} customers")

customer = by_number[selected]
{"Customer 360": view_customer_360, "Recharge": view_recharge, "Copilot": view_copilot}[st.session_state.nav](customer)
