"""Provider selection for get_llm(). No network: constructing the chat models makes no calls."""
import pytest

from agents.llm import get_llm, get_model_name, resolve_provider

ALL_VARS = [
    "ACTIVE_PROVIDER", "ENV", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_TEXT_MODEL", "GROQ_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY",
    "GROQ_TEXT_MODEL", "OPENAI_TEXT_MODEL", "ANTHROPIC_TEXT_MODEL", "OLLAMA_TEXT_MODEL", "OLLAMA_NUM_GPU",
]


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for var in ALL_VARS:
        monkeypatch.delenv(var, raising=False)


def test_default_is_ollama():
    assert resolve_provider() == "ollama"


@pytest.mark.parametrize("legacy,expected", [("dev", "ollama"), ("demo", "anthropic")])
def test_legacy_env_switch_still_works(monkeypatch, legacy, expected):
    monkeypatch.setenv("ENV", legacy)
    assert resolve_provider() == expected


def test_active_provider_beats_legacy_env(monkeypatch):
    monkeypatch.setenv("ENV", "demo")
    monkeypatch.setenv("ACTIVE_PROVIDER", "groq")
    assert resolve_provider() == "groq"


def test_explicit_arguments_beat_environment(monkeypatch):
    monkeypatch.setenv("ACTIVE_PROVIDER", "groq")
    assert resolve_provider(env="dev") == "ollama"
    assert resolve_provider(env="dev", provider="openai") == "openai"


def test_unknown_provider_is_rejected(monkeypatch):
    monkeypatch.setenv("ACTIVE_PROVIDER", "gemini")
    with pytest.raises(ValueError, match="Unknown LLM provider"):
        resolve_provider()


@pytest.mark.parametrize(
    "provider,key_var,class_name,default_model",
    [
        ("groq", "GROQ_API_KEY", "ChatGroq", "openai/gpt-oss-120b"),
        ("openai", "OPENAI_API_KEY", "ChatOpenAI", "gpt-4o-mini"),
        ("anthropic", "ANTHROPIC_API_KEY", "ChatAnthropic", "claude-sonnet-4-6"),
    ],
)
def test_each_hosted_provider_builds_the_right_client(monkeypatch, provider, key_var, class_name, default_model):
    monkeypatch.setenv(key_var, "test-key")
    llm = get_llm(provider=provider)
    assert type(llm).__name__ == class_name
    assert get_model_name(provider) == default_model


def test_model_name_is_configurable(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "test-key")
    monkeypatch.setenv("GROQ_TEXT_MODEL", "llama-3.1-8b-instant")
    llm = get_llm(provider="groq")
    assert llm.model_name == "llama-3.1-8b-instant"


@pytest.mark.parametrize("provider,key_var", [("groq", "GROQ_API_KEY"), ("openai", "OPENAI_API_KEY"), ("anthropic", "ANTHROPIC_API_KEY")])
def test_missing_api_key_fails_with_a_clear_message(provider, key_var):
    with pytest.raises(ValueError, match=key_var):
        get_llm(provider=provider)


def test_ollama_needs_no_key_and_honours_num_gpu(monkeypatch):
    monkeypatch.setenv("OLLAMA_NUM_GPU", "0")
    llm = get_llm(provider="ollama")
    assert type(llm).__name__ == "ChatOllama" and llm.num_gpu == 0 and llm.model == "llama3.1:8b"


def test_phase0_acceptance_call_signature_still_works():
    assert type(get_llm("dev")).__name__ == "ChatOllama"


def test_cloudflare_builds_an_account_scoped_openai_compatible_client(monkeypatch):
    monkeypatch.setenv("CLOUDFLARE_API_TOKEN", "test-token")
    monkeypatch.setenv("CLOUDFLARE_ACCOUNT_ID", "abc123")
    llm = get_llm(provider="cloudflare")
    assert type(llm).__name__ == "ChatOpenAI"
    assert llm.model_name == "@cf/meta/llama-3.1-8b-instruct-fp8"
    assert str(llm.openai_api_base) == "https://api.cloudflare.com/client/v4/accounts/abc123/ai/v1"
    assert llm.max_tokens == 4096  # Workers AI's small default would truncate JSON answers


def test_cloudflare_needs_both_token_and_account_id(monkeypatch):
    with pytest.raises(ValueError, match="CLOUDFLARE_API_TOKEN"):
        get_llm(provider="cloudflare")
    monkeypatch.setenv("CLOUDFLARE_API_TOKEN", "test-token")
    with pytest.raises(ValueError, match="CLOUDFLARE_ACCOUNT_ID"):
        get_llm(provider="cloudflare")
