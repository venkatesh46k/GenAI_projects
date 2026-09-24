import json
import os
import re
from datetime import datetime, timezone

LOG_PATH = os.path.join(os.path.dirname(__file__), "..", "logs", "interactions.jsonl")

# Same patterns as moderation.mask_pii; duplicated here to avoid a circular import.
_PII = [
    (re.compile(r"\b\d{10}\b"), "[MASKED_MSISDN]"),
    (re.compile(r"\bD-\w{6,}\b"), "[MASKED_DISPUTE_ID]"),
    (re.compile(r"\bTXN-\w{6,}\b"), "[MASKED_TXN_ID]"),
]


def _mask(text: str) -> str:
    for pattern, repl in _PII:
        text = pattern.sub(repl, text)
    return text


def log_interaction(state: dict) -> None:
    """Append one masked line per request to logs/interactions.jsonl (source for eval fixtures)."""
    entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "query": state.get("query", ""),
        "route": state.get("route"),
        "route_method": state.get("route_method"),
        "tool_calls": state.get("tool_calls", []),
        "answer_length": len(state.get("moderated_answer") or ""),
        "safety_flag": state.get("safety_flag"),
    }
    try:
        os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            # Mask the whole serialized line so PII in any field (query, tool_calls, ...) never hits disk.
            f.write(_mask(json.dumps(entry)) + "\n")
    except OSError:
        pass  # logging must never break a user request
