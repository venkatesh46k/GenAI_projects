"""DeepEval judge backed by whichever provider agents/llm.py is configured for.

Provider: JUDGE_PROVIDER if set, otherwise ACTIVE_PROVIDER (ollama | groq | cloudflare | openai | anthropic).
Model:    JUDGE_MODEL if set, otherwise that provider's configured model.
Using a different provider for judging than for the app is deliberate and supported: e.g. run the
assistant on Ollama and judge with a stronger hosted model.
"""
import asyncio
import os
import re
import threading
import time
from functools import lru_cache

from deepeval.models import DeepEvalBaseLLM
from langchain_core.callbacks import get_usage_metadata_callback

from agents.llm import get_llm, get_model_name, resolve_provider
from agents.utils import parse_json

MAX_ATTEMPTS = 6

# Tokens spent by the judge in this process, so a run can report what it actually cost.
USAGE = {"calls": 0, "input_tokens": 0, "output_tokens": 0}
_USAGE_LOCK = threading.Lock()


def _track(callback) -> None:
    with _USAGE_LOCK:
        USAGE["calls"] += 1
        for per_model in callback.usage_metadata.values():
            USAGE["input_tokens"] += per_model.get("input_tokens", 0)
            USAGE["output_tokens"] += per_model.get("output_tokens", 0)


def _text(message) -> str:
    """Chat models return a str, or (Anthropic) a list of content blocks."""
    content = message.content
    if isinstance(content, str):
        return content
    return "".join(block.get("text", "") if isinstance(block, dict) else str(block) for block in content)


MAX_RETRY_WAIT_S = 90  # a provider asking us to wait longer than this is not a transient blip


_QUOTA_MARKERS = ("per day", "(tpd)", "daily free allocation", "neurons", "insufficient_quota", "no credits")


def is_quota_error(exc: Exception) -> bool:
    """A spent daily allowance or credit balance: retrying, or running more tests, cannot help."""
    text = f"{type(exc).__name__} {exc}".lower()
    return any(marker in text for marker in _QUOTA_MARKERS)


def _is_retryable(exc: Exception) -> bool:
    text = f"{type(exc).__name__} {exc}".lower()
    # A per-day quota will not clear by retrying for a few seconds: fail fast so the run stops
    # immediately with a clear message instead of burning tens of minutes on hopeless retries.
    if is_quota_error(exc):
        return False
    wait = re.search(r"try again in (?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?", text)
    if wait and any(wait.groups()):
        hours, minutes, seconds = (float(g or 0) for g in wait.groups())
        if hours * 3600 + minutes * 60 + seconds > MAX_RETRY_WAIT_S:
            return False
    return any(s in text for s in ("429", "rate limit", "ratelimit", "overloaded", "timeout", "temporarily"))


class LangChainJudge(DeepEvalBaseLLM):
    def __init__(self, provider: str | None = None):
        self.provider = resolve_provider(provider=provider or os.getenv("JUDGE_PROVIDER") or None)
        self.model_id = os.getenv("JUDGE_MODEL") or get_model_name(self.provider)
        super().__init__(model=f"{self.provider}:{self.model_id}")

    def load_model(self):
        return get_llm(provider=self.provider, temperature=0, model=self.model_id)

    def get_model_name(self) -> str:
        return f"{self.provider}:{self.model_id}"

    def _with_retries(self, fn):
        for attempt in range(1, MAX_ATTEMPTS + 1):
            try:
                return fn()
            except Exception as exc:
                if attempt == MAX_ATTEMPTS or not _is_retryable(exc):
                    raise
                time.sleep(min(2**attempt, 30))  # free-tier hosted models rate-limit aggressively

    def generate(self, prompt: str, schema=None):
        with get_usage_metadata_callback() as usage:
            try:
                return self._generate(prompt, schema)
            finally:
                _track(usage)

    def _generate(self, prompt: str, schema=None):
        if schema is None:
            return self._with_retries(lambda: _text(self.model.invoke(prompt)))

        # DeepEval expects an instance of `schema` back. Native structured output first, then
        # plain text parsed as JSON for models/providers where that path is unreliable.
        try:
            result = self._with_retries(lambda: self.model.with_structured_output(schema).invoke(prompt))
            if isinstance(result, schema):
                return result
        except Exception:
            pass
        raw = self._with_retries(lambda: _text(self.model.invoke(prompt)))
        data = parse_json(raw)
        if data is None:
            raise ValueError(f"Judge returned non-JSON output for {schema.__name__}: {raw[:200]!r}")
        return schema(**data)

    async def a_generate(self, prompt: str, schema=None):
        return await asyncio.to_thread(self.generate, prompt, schema)


@lru_cache(maxsize=None)
def get_judge() -> LangChainJudge:
    return LangChainJudge()
