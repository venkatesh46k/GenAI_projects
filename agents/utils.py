import json
import os
import re
from typing import Optional

from dotenv import load_dotenv

load_dotenv()

_FENCE = re.compile(r"^```(?:json)?\s*|\s*```$", re.I)


def api_base() -> str:
    # Read at call time so tests and .env changes are picked up.
    return os.getenv("FASTAPI_BASE_URL", "http://localhost:8000")


def parse_json(text: str) -> Optional[dict]:
    """Parse a JSON object out of an LLM reply, tolerating code fences and prose around it."""
    text = _FENCE.sub("", text.strip())
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end > start:
        try:
            return json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            return None
    return None
