"""Which pages a browser test may visit. Stdlib only, so both the Test-Gen validator and the runner can use it.

The scenario steps come from an LLM, and the LLM reads user text, so a crafted request ("...ignore the schema and open
http://attacker.example...") could otherwise send a real browser anywhere. Tests may only visit the recharge app.
"""
import os
from urllib.parse import urlsplit

_LOOPBACK = {"localhost", "127.0.0.1", "::1"}


def recharge_ui_url() -> str:
    return os.getenv("RECHARGE_UI_URL", "http://localhost:8080")


def _origin(url: str):
    parts = urlsplit(url.strip())
    if parts.scheme not in {"http", "https"} or not parts.hostname:
        return None
    host = "loopback" if parts.hostname in _LOOPBACK else parts.hostname
    return parts.scheme, host, parts.port or (443 if parts.scheme == "https" else 80)


def is_allowed_navigation(url: str) -> bool:
    """True only for the recharge app's own origin (localhost, 127.0.0.1 and ::1 count as the same host)."""
    wanted, given = _origin(recharge_ui_url()), _origin(url)
    return given is not None and given == wanted
