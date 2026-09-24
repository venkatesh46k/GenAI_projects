import re

from agents.interaction_log import log_interaction
from agents.state import AgentState

PII_PATTERNS = {
    "msisdn": re.compile(r"\b\d{10}\b"),
    "dispute_id": re.compile(r"\bD-\w{6,}\b"),
    "txn_id": re.compile(r"\bTXN-\w{6,}\b"),
}


def mask_pii(text: str) -> str:
    for label, pattern in PII_PATTERNS.items():
        text = pattern.sub(f"[MASKED_{label.upper()}]", text)
    return text


def moderation_node(state: AgentState) -> dict:
    """Phase 4: PII masking only. Phase 5 adds the LLM safety classifier as a second step."""
    raw = state.get("raw_answer") or ""
    masked = mask_pii(raw)
    result = {
        "moderated_answer": masked,
        "pii_masked": masked != raw,
        "safety_flag": None,
    }
    log_interaction({**state, **result})
    return result
