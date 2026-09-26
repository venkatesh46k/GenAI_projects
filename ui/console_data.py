"""Pure display helpers for the console: no Streamlit, so they can be unit-tested directly."""
from datetime import datetime

import pandas as pd

LOW_BALANCE_THRESHOLD = 5.0  # below this, outgoing usage is barred (see data/docs/low_balance_barring.md)

STATUS_STYLE = {
    "active": ("Active", "#137333", "#e6f4ea"),
    "barred": ("Barred", "#c5221f", "#fce8e6"),
    "expired": ("Expired", "#b06000", "#fef7e0"),
}


def money(value: float) -> str:
    return f"₹{value:,.2f}"


def fmt_ts(value: str | None) -> str:
    """ISO timestamp or date -> '26 Sep 2026, 00:41' (or '26 Sep 2026' for a bare date). Unparseable -> as is."""
    if not value:
        return "-"
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return value
    return parsed.strftime("%d %b %Y, %H:%M") if "T" in value else parsed.strftime("%d %b %Y")


def customer_option(subscriber: dict) -> str:
    # Short on purpose: the sidebar picker is narrow and clipped "9988776655 · PLAN_199 · barred" to "...barre".
    return f"{subscriber['msisdn']}  ·  {subscriber['status']}"


def status_badge_html(status: str) -> str:
    label, color, background = STATUS_STYLE.get(status, (status.title(), "#3c4043", "#f1f3f4"))
    return (
        f'<span style="background:{background};color:{color};padding:2px 10px;border-radius:999px;'
        f'font-size:0.8rem;font-weight:600;">{label}</span>'
    )


def balance_warning(balance: float, status: str) -> str | None:
    if status == "barred":
        return "This number is barred. A recharge that brings the balance to ₹5 or more lifts outgoing barring."
    if balance < LOW_BALANCE_THRESHOLD:
        return f"Balance is below {money(LOW_BALANCE_THRESHOLD)}: outgoing usage outside the plan bundle is barred."
    return None


def _usage(cdr: dict) -> str:
    kind = cdr["call_type"]
    if kind == "voice":
        seconds = cdr.get("duration_sec") or 0
        return f"{seconds // 60}m {seconds % 60:02d}s"
    if kind == "data":
        return f"{cdr.get('data_mb') or 0:,.1f} MB"
    return "1 SMS"


def cdr_frame(cdrs: list[dict]) -> pd.DataFrame:
    return pd.DataFrame(
        [{"Time": fmt_ts(c["timestamp"]), "Type": c["call_type"].title(), "Usage": _usage(c), "Charge": money(c["charge"])} for c in cdrs],
        columns=["Time", "Type", "Usage", "Charge"],
    )


def transaction_frame(transactions: list[dict]) -> pd.DataFrame:
    return pd.DataFrame(
        [
            {
                "Time": fmt_ts(t["timestamp"]),
                "Type": t["type"].title(),
                "Amount": money(t["amount"]),
                "Balance after": money(t["balance_after"]),
                "Reference": t["txn_id"],
            }
            for t in transactions
        ],
        columns=["Time", "Type", "Amount", "Balance after", "Reference"],
    )


def dispute_frame(disputes: list[dict]) -> pd.DataFrame:
    return pd.DataFrame(
        [
            {
                "Dispute": d["dispute_id"],
                "Opened": fmt_ts(d["created_at"]),
                "Amount": money(d["amount_disputed"]),
                "Status": d["status"].title(),
                "Reason": d["reason"],
            }
            for d in disputes
        ],
        columns=["Dispute", "Opened", "Amount", "Status", "Reason"],
    )


def route_label(state: dict) -> str:
    """'dispute (regex)' style summary of how the copilot handled a message."""
    route, method = state.get("route"), state.get("route_method")
    return f"{route} ({method})" if route and method else (route or "")


SUGGESTED_PROMPTS = [
    "What is the balance for this customer?",
    "What is the grace period after a plan expires?",
    "I was charged twice, Rs 199. I want a refund",
    "Verify that recharging 199 updates the balance",
]
