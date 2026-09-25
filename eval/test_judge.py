"""Offline tests for the judge adapter: no network, the chat model is faked."""
import pytest
from pydantic import BaseModel

from eval import judge as judge_module
from eval.judge import LangChainJudge, _is_retryable, _text


class Verdict(BaseModel):
    verdict: str
    score: float


class FakeMessage:
    def __init__(self, content):
        self.content = content


class FakeChat:
    def __init__(self, text=None, structured=None, fail_structured=False, errors=()):
        self.text, self.structured, self.fail_structured = text, structured, fail_structured
        self.errors = list(errors)
        self.calls = 0

    def invoke(self, prompt):
        self.calls += 1
        if self.errors:
            raise self.errors.pop(0)
        return FakeMessage(self.text)

    def with_structured_output(self, schema):
        outer = self

        class Structured:
            def invoke(self, prompt):
                if outer.fail_structured:
                    raise RuntimeError("structured output unsupported")
                return outer.structured

        return Structured()


@pytest.fixture
def make_judge(monkeypatch):
    monkeypatch.setattr(judge_module, "MAX_ATTEMPTS", 3)
    monkeypatch.setattr(judge_module.time, "sleep", lambda s: None)

    def build(chat):
        monkeypatch.setattr(LangChainJudge, "load_model", lambda self: chat)
        monkeypatch.setenv("GROQ_API_KEY", "x")
        return LangChainJudge(provider="groq")

    return build


def test_plain_generate_returns_text(make_judge):
    assert make_judge(FakeChat(text="hello")).generate("hi") == "hello"


def test_schema_uses_native_structured_output(make_judge):
    chat = FakeChat(structured=Verdict(verdict="yes", score=1.0))
    assert make_judge(chat).generate("p", schema=Verdict) == Verdict(verdict="yes", score=1.0)


def test_schema_falls_back_to_parsing_json_text(make_judge):
    chat = FakeChat(text='```json\n{"verdict": "no", "score": 0.5}\n```', fail_structured=True)
    assert make_judge(chat).generate("p", schema=Verdict) == Verdict(verdict="no", score=0.5)


def test_schema_with_unparseable_text_raises_clearly(make_judge):
    with pytest.raises(ValueError, match="non-JSON"):
        make_judge(FakeChat(text="I cannot do that", fail_structured=True)).generate("p", schema=Verdict)


def test_rate_limit_errors_are_retried(make_judge):
    chat = FakeChat(text="ok", errors=[RuntimeError("Error code: 429 rate limit"), RuntimeError("429")])
    assert make_judge(chat).generate("p") == "ok" and chat.calls == 3


def test_non_retryable_errors_fail_immediately(make_judge):
    chat = FakeChat(text="ok", errors=[RuntimeError("invalid api key")])
    with pytest.raises(RuntimeError, match="invalid api key"):
        make_judge(chat).generate("p")
    assert chat.calls == 1


def test_retries_give_up_after_max_attempts(make_judge):
    chat = FakeChat(text="ok", errors=[RuntimeError("429")] * 5)
    with pytest.raises(RuntimeError):
        make_judge(chat).generate("p")
    assert chat.calls == 3


def test_content_block_lists_are_flattened():
    assert _text(FakeMessage([{"type": "text", "text": "a"}, {"type": "text", "text": "b"}])) == "ab"


def test_model_name_includes_provider(make_judge):
    assert make_judge(FakeChat(text="x")).get_model_name().startswith("groq:")


def test_retryable_detection():
    assert _is_retryable(RuntimeError("429 Too Many Requests")) and not _is_retryable(ValueError("bad schema"))


DAILY = (
    "Error code: 429 - Rate limit reached for model `openai/gpt-oss-120b` on tokens per day (TPD): "
    "Limit 200000, Used 199418, Requested 2582. Please try again in 14m24s."
)


def test_daily_quota_is_not_retried():
    assert not _is_retryable(RuntimeError(DAILY))


def test_long_waits_are_not_retried_but_short_ones_are():
    assert not _is_retryable(RuntimeError("429 rate limit. Please try again in 8m3.4s."))
    assert not _is_retryable(RuntimeError("429 rate limit. Please try again in 1h2m."))
    assert _is_retryable(RuntimeError("429 rate limit on tokens per minute. Please try again in 6.5s."))
    assert _is_retryable(RuntimeError("429 rate limit. Please try again in 1m10s."))


def test_daily_quota_fails_immediately_without_sleeping(make_judge):
    chat = FakeChat(text="ok", errors=[RuntimeError(DAILY)])
    with pytest.raises(RuntimeError, match="tokens per day"):
        make_judge(chat).generate("p")
    assert chat.calls == 1


def test_hallucination_polarity_is_higher_is_better(make_judge):
    """DeepEval 4.x: score = fraction of contexts the answer agrees with, passing when score >= threshold.

    If a DeepEval upgrade flips this, thresholds.HALLUCINATION would silently pass contradicting answers.
    """
    from deepeval.metrics import HallucinationMetric

    from eval.thresholds import HALLUCINATION

    metric = HallucinationMetric(threshold=HALLUCINATION, model=make_judge(FakeChat(text="x")))
    metric.error = None
    metric.score = 0.0  # answer contradicts every context
    assert metric.is_successful() is False
    metric.score = 1.0  # answer agrees with every context
    assert metric.is_successful() is True


@pytest.mark.parametrize(
    "message",
    [
        "429: you have used up your daily free allocation of 10,000 neurons, please upgrade",
        "Error code: 429 - insufficient_quota: You have no credits remaining",
    ],
)
def test_exhausted_free_allowances_are_not_retried(message):
    assert not _is_retryable(RuntimeError(message))


def test_judge_model_can_differ_from_the_app_model(monkeypatch):
    monkeypatch.setenv("CLOUDFLARE_API_TOKEN", "t")
    monkeypatch.setenv("CLOUDFLARE_ACCOUNT_ID", "a")
    monkeypatch.setenv("CLOUDFLARE_TEXT_MODEL", "@cf/meta/llama-3.1-8b-instruct-fp8")
    monkeypatch.setenv("JUDGE_MODEL", "@cf/openai/gpt-oss-120b")
    judge = LangChainJudge(provider="cloudflare")
    assert judge.model.model_name == "@cf/openai/gpt-oss-120b"
    assert judge.get_model_name() == "cloudflare:@cf/openai/gpt-oss-120b"


# ---------- reporting: resumable runs ----------

def test_resume_skips_only_metrics_that_already_passed_for_the_same_answer(tmp_path, monkeypatch):
    from eval import reporting

    monkeypatch.setattr(reporting, "RESULTS_DIR", str(tmp_path))
    monkeypatch.setattr(reporting, "RESULTS_PATH", str(tmp_path / "latest.jsonl"))
    monkeypatch.setattr(reporting, "get_judge", lambda: type("J", (), {"get_model_name": lambda self: "test:judge"})())
    monkeypatch.setenv("EVAL_RESUME", "1")

    class Case:
        input, actual_output, expected_output, retrieval_context = "q", "answer", "reference", ["ctx"]

    class Metric:
        threshold, calls = 0.5, 0

        def __init__(self, name, score):
            self.__name__, self._score = name, score

        def measure(self, case):
            Metric.calls += 1
            self.score, self.reason = self._score, "r"

        def is_successful(self):
            return self.score >= self.threshold

    try:
        reporting.run_metrics(Case, [Metric("Good", 1.0), Metric("Bad", 0.1)], "t")
    except AssertionError:
        pass
    assert Metric.calls == 2

    Metric.calls = 0
    try:
        reporting.run_metrics(Case, [Metric("Good", 1.0), Metric("Bad", 0.1)], "t")
    except AssertionError:
        pass
    assert Metric.calls == 1  # "Good" passed before and is skipped; "Bad" failed, so it is re-measured

    class Changed(Case):
        actual_output = "a different answer"

    Metric.calls = 0
    try:
        reporting.run_metrics(Changed, [Metric("Good", 1.0)], "t")
    except AssertionError:
        pass
    assert Metric.calls == 1  # new fingerprint: the earlier pass is not reused

    class NewReference(Case):
        expected_output = "a tightened reference answer"

    Metric.calls = 0
    try:
        reporting.run_metrics(NewReference, [Metric("Good", 1.0)], "t")
    except AssertionError:
        pass
    assert Metric.calls == 1  # recall/precision/correctness depend on the reference, so its pass is not reused


def test_usage_tracking_accumulates_tokens_across_models():
    from eval import judge as judge_module

    before = dict(judge_module.USAGE)
    fake = type("CB", (), {"usage_metadata": {"m1": {"input_tokens": 100, "output_tokens": 10}, "m2": {"input_tokens": 5}}})()
    judge_module._track(fake)
    assert judge_module.USAGE["calls"] == before["calls"] + 1
    assert judge_module.USAGE["input_tokens"] == before["input_tokens"] + 105
    assert judge_module.USAGE["output_tokens"] == before["output_tokens"] + 10


def test_toxicity_polarity_is_higher_is_better(make_judge):
    """DeepEval 4.x toxicity = fraction of NON-toxic statements, passing when score >= threshold."""
    from deepeval.metrics import ToxicityMetric

    from eval.thresholds import TOXICITY

    metric = ToxicityMetric(threshold=TOXICITY, model=make_judge(FakeChat(text="x")))
    metric.error = None
    metric.score = 0.0  # entirely toxic
    assert metric.is_successful() is False
    metric.score = 1.0  # entirely clean
    assert metric.is_successful() is True
    metric.score = 0.5  # half the statements toxic must NOT pass
    assert metric.is_successful() is False
