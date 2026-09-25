"""Single place that decides which LLM the whole project talks to.

Configured entirely from environment / .env:

    ACTIVE_PROVIDER=groq        # ollama | groq | cloudflare | openai | anthropic
    GROQ_API_KEY=...            GROQ_TEXT_MODEL=openai/gpt-oss-120b
    CLOUDFLARE_API_TOKEN=...    CLOUDFLARE_ACCOUNT_ID=...   CLOUDFLARE_TEXT_MODEL=@cf/meta/llama-3.1-8b-instruct-fp8
    OPENAI_API_KEY=...          OPENAI_TEXT_MODEL=gpt-4o-mini
    ANTHROPIC_API_KEY=...       ANTHROPIC_TEXT_MODEL=claude-sonnet-4-6
    OLLAMA_HOST=...             OLLAMA_TEXT_MODEL=llama3.1:8b

Backwards compatible with the original ENV switch: without ACTIVE_PROVIDER, ENV=demo means anthropic and
anything else means ollama. Precedence: `provider` argument > `env` argument > ACTIVE_PROVIDER > ENV.
"""
import os

from dotenv import load_dotenv

load_dotenv()

PROVIDERS = ("ollama", "groq", "cloudflare", "openai", "anthropic")

# provider -> (API key variable or None, model variable, default model)
_CONFIG = {
    "ollama": (None, "OLLAMA_TEXT_MODEL", "llama3.1:8b"),
    "groq": ("GROQ_API_KEY", "GROQ_TEXT_MODEL", "openai/gpt-oss-120b"),
    "cloudflare": ("CLOUDFLARE_API_TOKEN", "CLOUDFLARE_TEXT_MODEL", "@cf/meta/llama-3.1-8b-instruct-fp8"),
    "openai": ("OPENAI_API_KEY", "OPENAI_TEXT_MODEL", "gpt-4o-mini"),
    "anthropic": ("ANTHROPIC_API_KEY", "ANTHROPIC_TEXT_MODEL", "claude-sonnet-4-6"),
}

_LEGACY_ENV = {"dev": "ollama", "demo": "anthropic"}


def resolve_provider(env: str | None = None, provider: str | None = None) -> str:
    if provider:
        chosen = provider
    elif env:
        chosen = _LEGACY_ENV.get(env, env)
    else:
        chosen = os.getenv("ACTIVE_PROVIDER") or _LEGACY_ENV.get(os.getenv("ENV", "dev"), "ollama")
    chosen = chosen.strip().lower()
    if chosen not in PROVIDERS:
        raise ValueError(f"Unknown LLM provider {chosen!r}; expected one of {', '.join(PROVIDERS)}")
    return chosen


def get_model_name(provider: str) -> str:
    _, model_var, default = _CONFIG[provider]
    return os.getenv(model_var) or default


def get_llm(env: str | None = None, provider: str | None = None, temperature: float = 0, model: str | None = None):
    """`model` overrides the provider's configured model (e.g. a stronger model just for the eval judge)."""
    provider = resolve_provider(env, provider)
    key_var, _, _ = _CONFIG[provider]
    model = model or get_model_name(provider)

    api_key = None
    if key_var:
        api_key = os.getenv(key_var)
        if not api_key:
            raise ValueError(f"{key_var} is not set, but the LLM provider is {provider!r}. Add it to .env.")

    if provider == "groq":
        from langchain_groq import ChatGroq

        return ChatGroq(model=model, api_key=api_key, temperature=temperature)
    if provider == "cloudflare":
        # Workers AI exposes an OpenAI-compatible endpoint, scoped to the account.
        from langchain_openai import ChatOpenAI

        account_id = os.getenv("CLOUDFLARE_ACCOUNT_ID")
        if not account_id:
            raise ValueError(
                "CLOUDFLARE_ACCOUNT_ID is not set, but the LLM provider is 'cloudflare'. Add it to .env "
                "(dashboard: Workers AI page, or the 32-character id in your dashboard URL)."
            )
        return ChatOpenAI(
            model=model,
            api_key=api_key,
            temperature=temperature,
            base_url=f"https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1",
            # Workers AI applies a small default output cap, which truncates JSON answers and leaves
            # reasoning models with nothing after they finish thinking. Set an explicit, generous one.
            max_tokens=int(os.getenv("CLOUDFLARE_MAX_TOKENS", "4096")),
        )
    if provider == "openai":
        from langchain_openai import ChatOpenAI

        return ChatOpenAI(model=model, api_key=api_key, temperature=temperature)
    if provider == "anthropic":
        from langchain_anthropic import ChatAnthropic

        return ChatAnthropic(model=model, api_key=api_key, temperature=temperature)

    from langchain_ollama import ChatOllama

    kwargs = {}
    # Optional escape hatch for flaky CUDA runners on small GPUs: OLLAMA_NUM_GPU=0 forces CPU-only.
    if os.getenv("OLLAMA_NUM_GPU"):
        kwargs["num_gpu"] = int(os.environ["OLLAMA_NUM_GPU"])
    return ChatOllama(
        model=model,
        base_url=os.getenv("OLLAMA_HOST", "http://localhost:11434"),
        temperature=temperature,
        **kwargs,
    )
