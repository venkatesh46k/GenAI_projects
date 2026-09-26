"""Hugging Face Spaces entrypoint (SDK: Streamlit, app file: deploy/app.py).

A Space runs one Streamlit process, but the console needs the mock billing API and a seeded database next to it. This
file starts both inside the Space, points the app at a hosted LLM (Ollama is not available there), turns off the
browser-test route (no Node/Playwright in the Space), then hands over to the console.

Space settings:
    Secrets   ACTIVE_PROVIDER = groq | openai | anthropic | cloudflare        (one hosted provider)
              and that provider's key, e.g. GROQ_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY
              (Cloudflare also needs CLOUDFLARE_ACCOUNT_ID). Never commit keys.
"""
import os
import socket
import subprocess
import sys
import tempfile
import time

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, ROOT)
os.chdir(ROOT)

# Demo defaults; anything set in the Space's secrets/variables wins.
os.environ.setdefault("ENABLE_QA_RUNS", "0")
os.environ.setdefault("FASTAPI_BASE_URL", "http://127.0.0.1:8000")
os.environ.setdefault("BILLING_DB_PATH", os.path.join(tempfile.gettempdir(), "billing.db"))  # repo dir may be read-only


def _api_is_up(port: int = 8000) -> bool:
    with socket.socket() as sock:
        sock.settimeout(0.5)
        return sock.connect_ex(("127.0.0.1", port)) == 0


def ensure_backend() -> None:
    """Seed the demo database and start the billing API once per container (Streamlit re-runs this file often)."""
    if _api_is_up():
        return
    from mock_api import seed

    seed.seed()
    subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "mock_api.main:app", "--host", "127.0.0.1", "--port", "8000"],
        env=os.environ.copy(),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    for _ in range(50):  # up to ~10 s for the API to accept connections
        if _api_is_up():
            return
        time.sleep(0.2)


def check_llm_is_configured() -> str | None:
    """A readable message if the hosted provider is not configured, else None."""
    from agents.llm import get_llm, resolve_provider

    provider = resolve_provider()
    if provider == "ollama":
        return "This deployment needs a hosted LLM: set ACTIVE_PROVIDER (groq, openai, anthropic or cloudflare) and its API key in the Space secrets."
    try:
        get_llm(provider=provider)
    except ValueError as exc:
        return str(exc)
    return None


ensure_backend()

import streamlit as st  # noqa: E402

if problem := check_llm_is_configured():
    # Show the console anyway (customer data works without an LLM); only the Copilot needs one.
    os.environ["DEPLOY_LLM_PROBLEM"] = problem

exec(compile(open(os.path.join(ROOT, "ui", "chat_app.py"), encoding="utf-8").read(), "ui/chat_app.py", "exec"))
