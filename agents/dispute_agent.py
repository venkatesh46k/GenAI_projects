import re

import requests

from agents.llm import get_llm
from agents.state import AgentState
from agents.utils import api_base, parse_json
from rag.retriever import cached_retriever

ESCALATION_KEYWORDS = re.compile(r"\b(escalate|manager|complaint|file a case|supervisor)\b", re.I)
AMOUNT_PATTERN = re.compile(r"(?:₹|rs\.?|inr)\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:rupees|rs\b)", re.I)

# SOP escalation criterion: disputes above this amount go to a human specialist.
ESCALATION_AMOUNT = 500.0
# Confidence that a dispute can be resolved without a human. Decided in code from the SOP criteria:
# a small local model's self-reported confidence did not discriminate (0.0 for every dispute).
CONFIDENCE_AUTO, CONFIDENCE_ESCALATE = 0.8, 0.3

DISPUTE_PROMPT = """You are a billing dispute-resolution assistant. Using the dispute-resolution
SOP context below and the subscriber's dispute record, write "explanation": a 2-3 sentence
message addressed directly to the subscriber. Confirm that their dispute has been registered,
say it will now be reviewed, and give the resolution timeline from the SOP. Do NOT promise a
refund, and do NOT mention internal criteria, thresholds or escalation rules. Amounts are in Indian rupees
(₹); never use $.
Respond as JSON only: {{"explanation": "..."}}

SOP CONTEXT:
{context}

DISPUTE RECORD (JSON): {record}
USER QUERY: {query}"""


def extract_amount(query: str) -> float:
    m = AMOUNT_PATTERN.search(query)
    return float(m.group(1) or m.group(2)) if m else 0.0


def dispute_node(state: AgentState) -> dict:
    msisdn = state.get("msisdn")
    if not msisdn:
        return {
            "raw_answer": "I can help with that. Could you share the 10-digit mobile number the charge relates to?",
            "dispute_confidence": 1.0,
        }

    query = state["query"]
    amount = extract_amount(query)
    try:
        resp = requests.post(
            f"{api_base()}/dispute",
            json={"msisdn": msisdn, "reason": query, "amount_disputed": amount},
            timeout=5,
        )
        resp.raise_for_status()
        record = resp.json()
    except requests.exceptions.RequestException:
        return {"raw_answer": "The dispute system is temporarily unavailable.", "dispute_confidence": 1.0}

    docs = cached_retriever().invoke("dispute resolution SOP steps timelines escalation criteria")
    context = "\n\n".join(d.page_content for d in docs)
    raw = get_llm().invoke(DISPUTE_PROMPT.format(context=context, record=record, query=query)).content

    explanation = (parse_json(raw) or {}).get("explanation") or raw
    confidence = CONFIDENCE_ESCALATE if amount > ESCALATION_AMOUNT else CONFIDENCE_AUTO

    return {
        "raw_answer": explanation,
        "dispute_id": record["dispute_id"],
        "dispute_confidence": confidence,
        "retrieved_context": [d.page_content for d in docs],
        "tool_calls": [{"endpoint": "/dispute", "msisdn": msisdn, "dispute_id": record["dispute_id"]}],
    }


def dispute_route_decision(state: AgentState) -> str:
    # Enforced in code, not left to the LLM alone.
    if state.get("dispute_id") and (
        state.get("dispute_confidence", 1.0) < 0.5 or ESCALATION_KEYWORDS.search(state["query"])
    ):
        return "escalation"
    return "moderate"
