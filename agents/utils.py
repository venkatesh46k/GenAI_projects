import json
import os
import re
from typing import Optional

from dotenv import load_dotenv

load_dotenv()

_FENCE = re.compile(r"^```(?:json)?\s*|\s*```$", re.I)


def api_base() -> str:
    # Read at call time so tests and .env changes are picked up.
    # BILLING_API_URL is the current name; FASTAPI_BASE_URL is kept so existing .env files keep working.
    url = os.getenv("BILLING_API_URL") or os.getenv("FASTAPI_BASE_URL", "http://localhost:8000")
    # On Windows "localhost" resolves to IPv6 (::1) first; nothing listens there, so every request waits ~2 s
    # before falling back to IPv4, where uvicorn listens. Six calls to draw one page = 12 s. Use loopback directly.
    return re.sub(r"//localhost(?=[:/]|$)", "//127.0.0.1", url)


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
