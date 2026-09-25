import os

# Must be set before deepeval is imported anywhere: no telemetry, no Confident AI login prompts.
os.environ.setdefault("DEEPEVAL_TELEMETRY_OPT_OUT", "YES")

from agents.llm import get_llm, resolve_provider  # noqa: E402

_JUDGE_PROVIDER = resolve_provider(provider=os.getenv("JUDGE_PROVIDER") or None)

if _JUDGE_PROVIDER == "ollama":
    # DeepEval's default timeouts assume a fast hosted API. One fixture x 5 metrics is dozens of sequential
    # LLM calls, which takes minutes on a local 8B model. Set before deepeval is imported; override freely.
    os.environ.setdefault("DEEPEVAL_PER_TASK_TIMEOUT_SECONDS_OVERRIDE", "3600")
    os.environ.setdefault("DEEPEVAL_PER_ATTEMPT_TIMEOUT_SECONDS_OVERRIDE", "900")

import pytest  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def judge_is_configured():
    """Fail once, clearly, if the judge provider has no key, instead of once per metric."""
    try:
        get_llm(provider=_JUDGE_PROVIDER)
    except ValueError as exc:
        pytest.exit(f"DeepEval judge is not configured: {exc}", returncode=2)


# Approximate list prices in USD per million tokens (input, output), for the cost line only. Check your
# provider's pricing page; these are not read from any API.
APPROX_PRICES = {"openai:gpt-4o-mini": (0.15, 0.60), "openai:gpt-4.1": (2.00, 8.00)}


def pytest_terminal_summary(terminalreporter):
    from eval.judge import USAGE, get_judge

    if not USAGE["calls"]:
        return
    name = get_judge().get_model_name()
    line = f"judge {name}: {USAGE['calls']} calls, {USAGE['input_tokens']:,} input + {USAGE['output_tokens']:,} output tokens"
    if name in APPROX_PRICES:
        price_in, price_out = APPROX_PRICES[name]
        cost = USAGE["input_tokens"] / 1e6 * price_in + USAGE["output_tokens"] / 1e6 * price_out
        line += f"  (~${cost:.3f} at ${price_in}/${price_out} per M tokens)"
    terminalreporter.write_sep("-", "judge token usage")
    terminalreporter.write_line(line)
