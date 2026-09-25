import json
import os
from datetime import datetime, timezone

from agents.pii import ALL_LABELS, mask_pii

LOG_PATH = os.path.join(os.path.dirname(__file__), "..", "logs", "interactions.jsonl")


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
        "classifier_error": state.get("classifier_error", False),
    }
    try:
        os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            # Mask the whole serialized line, every ID type, so PII in any field never hits disk.
            f.write(mask_pii(json.dumps(entry), ALL_LABELS) + "\n")
    except OSError:
        pass  # logging must never break a user request
