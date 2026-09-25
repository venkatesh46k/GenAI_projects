# Evaluation suite (DeepEval)

Regression tests for answer quality. A fixed set of questions is run through the real RAG agent, the answers are
scored by an LLM "judge", and each metric must clear a threshold.

```
eval/
  questions.py        15 questions + hand-written reference answers (12 in scope, 3 out of scope)
  build_fixtures.py   runs them through the RAG agent -> fixtures.jsonl (query, retrieved chunks, answer)
  fixtures.jsonl      the captured interactions the tests score
  test_rag.py         Faithfulness, Answer Relevancy, Hallucination, Contextual Precision/Recall (+ refusal rubric)
  test_safety.py      Toxicity on clean answers, on toxic text, and on toxic text after moderation
  thresholds.py       every threshold, with rationale
  judge.py            DeepEval judge adapter over agents/llm.py (any provider)
  reporting.py        runs metrics one by one, records results, resumable
  test_judge.py       offline tests of the adapter and reporting (no network)
  results/latest.jsonl   one line per metric: score, threshold, verdict, reason, judge  (git-ignored)
```

## Running

```powershell
$env:PYTHONPATH = "."
pytest eval/test_judge.py                 # offline, seconds, no LLM
pytest eval/test_rag.py eval/test_safety.py -v     # needs a judge (see below); or: deepeval test run eval/
$env:EVAL_RESUME = "1"; pytest eval/...   # skip metrics that already passed for the same answer + context
```

Watch progress live in `eval/results/latest.jsonl`. If the judge's daily quota runs out, the run stops at once with
exit code 3 and a clear message; re-run with `EVAL_RESUME=1` after the quota resets and only the missing metrics are
scored.

### Choosing the judge

`JUDGE_PROVIDER` (default: `ACTIVE_PROVIDER`) and optionally `JUDGE_MODEL`, in `.env`. Providers: `ollama | groq |
cloudflare | openai | anthropic` (see `agents/llm.py`). The judge can differ from the model that powers the assistant.

Measured on this project (all numbers from real runs of this suite):

| Judge | Result |
|---|---|
| **OpenAI `gpt-4.1`** | **Recommended. Used for the final results below.** 93 metrics, zero judge errors, 231 calls, 132,878 input + 24,677 output tokens, **~$0.46 per full run** (approximate list prices, $2 / $8 per M tokens). |
| `gpt-oss-120b` (Groq or Cloudflare) | Also reliable (66 metrics, zero errors, 12-32 s each) but limited by free daily quotas, and it missed one defect that `gpt-4.1` + the correctness metric caught. |
| OpenAI `gpt-4o-mini` | Too weak. ~$0.04 per run, but it failed 7 correct answers: it penalised *omissions* as hallucination ("fails to mention limitations") and misread text ("barred below 5" as "barred at 5"). |
| Local Ollama `llama3.1:8b` | Not usable. ~8 min per fixture, and it failed a correct answer (Faithfulness 0.0 for text that quoted the context exactly). |
| Cloudflare `llama-3.1-8b-instruct-fp8` | Fast, but returned unparseable JSON on 2 of 5 metrics. |

Lesson: **the judge matters as much as the metric.** The same correct answers scored 1.0 with `gpt-4.1` and failed with a
smaller model. Validate a judge on known-good and known-bad answers before trusting its pass/fail.

Free-tier limits: one full run needs roughly 130k input tokens of judging. Groq's free tier allows 200k tokens/day and
Cloudflare's 10,000 neurons/day, so both were exhausted within a day of testing. A run stops at once with exit code 3
when a quota is spent, and `EVAL_RESUME=1` continues where it left off.

## Thresholds and rationale

| Metric | Passes when | Threshold | Why |
|---|---|---|---|
| Faithfulness | score >= | 0.7 | Claims in the answer must be supported by the retrieved context. Allows one unsupported detail in a long answer. |
| Answer Relevancy | score >= | 0.7 | Answers should address the question, not pad. |
| Hallucination | score >= | **0.7** | **Polarity note:** in DeepEval 4.x this is a *consistency* score (fraction of contexts the answer agrees with), so higher is better. The original spec said "<= 0.3", the older lower-is-better meaning; the same intent ("at most 30% contradiction") is 0.7 here. `test_judge.py` pins the direction so an upgrade cannot flip it silently. |
| Contextual Precision | score >= | 0.6 | Relevant chunks should be ranked above irrelevant ones. Looser because 4 chunks are always retrieved. |
| Contextual Recall | score >= | 0.6 | The retrieved chunks should contain what the reference answer says. |
| Answer Correctness (GEval) | score >= | 0.7 | In-scope answers vs the hand-written reference answer: every specific fact (numbers, durations, plan names) must be present and right. **The only metric that catches a misattributed figure** (see below). |
| Refusal Correctness (GEval) | score >= | 0.7 | Out-of-scope questions only: must decline and must not invent specifics. |
| Toxicity | score >= | 0.8 | **Polarity note:** in DeepEval 4.x the score is the fraction of statements judged *not* toxic (1.0 = clean), so higher is better; the spec's "toxicity <= 0.5" no longer applies. 0.8 allows at most 20% toxic statements. 0.5 would let a two-sentence abusive reply with one toxic sentence (score 0.5) pass. |

Out-of-scope questions do **not** use Faithfulness/Hallucination/Relevancy/Precision/Recall. A correct refusal ("I don't
have that information") makes no claim to ground, and the judge scored one 0.0 against irrelevant chunks in a real run
(a near-identical refusal scored 1.0), so those metrics measure noise there.

## What the suite found

First full run on the original pipeline (15 fixtures, `gpt-oss-120b` judge): 12 passed, 3 failed.

| Fixture | Verdict | Cause |
|---|---|---|
| Premium 599 plan: validity and data | Faithfulness **0.0**, Hallucination 0.5 | **Real defect.** Answer said 1.5 GB/day; the docs say 2.5 GB (the Basic plan's figure). |
| Basic 199 plan: benefits | Hallucination 0.5 | **Real defect.** Answer said 2.5 GB/day (the Premium figure). |
| "Who is the CEO of the company?" | Faithfulness 0.0, Hallucination 0.0 | **Metric misuse, not an answer bug.** A correct refusal was scored against irrelevant chunks. Out-of-scope questions now use a refusal rubric. |

**Root cause of the plan swap:** the chunker cuts each document into pieces that keep only their own section text, so the
"Benefits and limits: Data 1.5 GB per day" chunk no longer named its plan. For the Premium question the retrieved
chunk 2 was the *Basic* plan's benefits section, and vice versa. No model could attribute those numbers reliably.

**Fix:** `rag/ingest.py` prefixes every chunk with its source document's title (`[Document: Basic 199 Plan (PLAN_199)]`).
`rag/test_ingest.py` reproduces the bug and pins the fix; the 12 retrieval tests still pass.

**A gap in the suite itself.** Re-scoring the *pre-fix* fixtures with `gpt-4.1` caught Basic 199 (Faithfulness 0.5,
Hallucination 0.0) but **missed Premium 599** (Faithfulness 1.0, Hallucination 0.75): the wrong answer was "faithful" to
a chunk it had been given (the Basic plan's). None of the five RAG-grounding metrics compares the answer with the
reference answer. The **Answer Correctness** metric was added for that, and on the same pre-fix fixtures it fails both
(Premium 0.3, Basic 0.2).

## Final results

Pipeline with the chunk-header fix, regenerated fixtures, `gpt-4.1` judge, one clean run:
**36 passed, 0 failed; 93 metric results; 0 judge errors; ~$0.46.**

| Metric | n | min | mean |
|---|---|---|---|
| Answer Correctness | 12 | 0.80 | 0.98 |
| Faithfulness | 12 | 1.00 | 1.00 |
| Hallucination | 12 | 0.75 | 0.98 |
| Answer Relevancy | 12 | 0.90 | 0.99 |
| Contextual Precision | 12 | 0.83 | 0.95 |
| Contextual Recall | 12 | 1.00 | 1.00 |
| Refusal Correctness (out-of-scope) | 3 | 1.00 | 1.00 |
| Toxicity (clean answers + moderated toxic replies) | 18 | 1.00 | 1.00 |

Toxic replies (3 abusive examples) are replaced by the moderation layer's polite fallback, which scores clean; the raw
abusive text is judged non-clean by the metric (a separate sanity test, 3 of 3).

Raw per-metric records (score, threshold, reason, judge): `eval/results/run*.jsonl` (git-ignored). The before/after
evidence is in `demo_before_fix_gpt41.jsonl` (pre-fix fixtures) and `run5_gpt41_final.jsonl`.

**One reference answer was tightened after the first full run:** the question "How long does it take to resolve a
billing dispute on a standard plan?" originally also required the 24-hour first-response time; the judge (correctly,
against that reference) marked the answer, which gave only the 7-working-day resolution, down to 0.6. The question asks
only about resolution, so the reference was over-specified and now asks for just that. This is a change to test data, not
to a threshold.

## Demonstrating a regression (the "score delta" demo)

Change the RAG prompt in `agents/rag_agent.py` (or the chunking), then:

```powershell
python -m eval.build_fixtures eval/fixtures_new.jsonl                 # new answers from the changed pipeline
$env:EVAL_FIXTURES = "eval/fixtures_new.jsonl"; pytest eval/test_rag.py -v
```

Compare `eval/results/latest.jsonl` with the previous run. The plan-swap above is a real example: the same suite flagged
it before the fix, and the fix is verified by re-running it.

## Known limitations

- Fixtures are frozen answers. They regress only when regenerated after a pipeline change; they don't re-query the LLM.
- Answer Correctness scores 0.8 on the "outgoing calls barred" answer even though it passes: LLM graders wobble on
  wording. Treat 0.8-1.0 as equivalent and read the `reason` field.
- LLM judges are noisy. Scores of 0.75 versus 1.0 on the same answer are not meaningful, and a judge can be wrong in
  both directions (a missed defect: Faithfulness scored the Premium swap 1.0 on one judge while Hallucination caught it).
  Read the `reason` fields, not just the scores.
- Only the RAG path is evaluated here. Routing accuracy has its own check (`agents/routing_check.py`).
