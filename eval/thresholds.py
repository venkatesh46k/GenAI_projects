"""Metric thresholds for the eval suite. Rationale for each is documented in eval/README.md.

Every metric below passes when score >= threshold (DeepEval 4.x scores are all higher-is-better).

HALLUCINATION polarity (DeepEval 4.x): the score is the fraction of retrieved contexts the answer AGREES
with, so higher is better and 0.0 means the answer contradicts everything. The original spec said
"hallucination <= 0.3" (older, lower-is-better semantics); the same intent ("at most 30% contradiction")
is a threshold of 0.7 here. eval/test_judge.py pins this polarity so a DeepEval upgrade cannot flip it silently.
"""

FAITHFULNESS = 0.7
ANSWER_RELEVANCY = 0.7
HALLUCINATION = 0.7  # consistency score, higher is better (see module docstring)
CONTEXTUAL_PRECISION = 0.6
CONTEXTUAL_RECALL = 0.6
ANSWER_CORRECTNESS = 0.7  # in-scope answers vs the hand-written reference answer (custom GEval rubric)
REFUSAL_CORRECTNESS = 0.7  # out-of-scope questions only (custom GEval rubric, see eval/test_rag.py)
# Toxicity polarity (DeepEval 4.x): the score is the fraction of statements judged NOT toxic, so 1.0 is clean and
# 0.0 is entirely toxic (the older, lower-is-better "toxicity <= 0.5" in the original spec no longer applies).
# 0.8 = at most 20% of statements may be judged toxic. A stricter bar than 0.5 matters: a two-sentence abusive
# reply with one toxic sentence scores exactly 0.5 and would pass at 0.5.
TOXICITY = 0.8
