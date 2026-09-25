"""DeepEval RAG regression suite: one test per fixture (see eval/README.md for thresholds and rationale).

    pytest eval/test_rag.py            (or: deepeval test run eval/test_rag.py)
    EVAL_FIXTURES=eval/other.jsonl pytest eval/test_rag.py
"""
import json
import os

import pytest
from deepeval.metrics import (
    AnswerRelevancyMetric,
    GEval,
    ContextualPrecisionMetric,
    ContextualRecallMetric,
    FaithfulnessMetric,
    HallucinationMetric,
)
from deepeval.test_case import LLMTestCase, SingleTurnParams

from eval.judge import get_judge
from eval.reporting import run_metrics
from eval.thresholds import (
    ANSWER_CORRECTNESS,
    ANSWER_RELEVANCY,
    CONTEXTUAL_PRECISION,
    CONTEXTUAL_RECALL,
    FAITHFULNESS,
    HALLUCINATION,
    REFUSAL_CORRECTNESS,
)

FIXTURES_PATH = os.getenv("EVAL_FIXTURES") or os.path.join(os.path.dirname(__file__), "fixtures.jsonl")

def load_fixtures():
    with open(FIXTURES_PATH, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


FIXTURES = load_fixtures()


CORRECTNESS_CRITERIA = (
    "Compare the actual output with the expected output for the question. The actual output is correct only if "
    "every specific fact in the expected output (numbers, durations, amounts, plan names, conditions) is present "
    "and stated correctly. Penalise heavily any specific figure or claim that contradicts the expected output, even "
    "if the wrong figure could be found somewhere in a retrieved document. Extra correct detail and different "
    "wording are fine."
)

REFUSAL_CRITERIA = (
    "The question cannot be answered from the retrieved context. The answer is correct only if it clearly says "
    "the information is not available (it may also point the customer to customer care) AND it does not state any "
    "specific facts such as prices, plan names, dates, people's names, numbers or rates that are not in the context. "
    "Penalise heavily any answer that invents specifics. Do not penalise a short refusal."
)


def metrics_for(fixture: dict):
    judge = get_judge()
    common = dict(model=judge, async_mode=False, include_reason=True)

    if not fixture.get("in_scope", True):
        # Out-of-scope questions: the right behaviour is to decline without inventing anything. Faithfulness,
        # hallucination, relevancy, precision and recall all assume the context can answer the question; a
        # correct refusal makes no factual claims to ground, and the judge was seen to score a correct
        # "I don't have that information" 0.0 against irrelevant chunks. A purpose-built rubric fits instead.
        return [
            GEval(
                name="Refusal Correctness",
                criteria=REFUSAL_CRITERIA,
                evaluation_params=[
                    SingleTurnParams.INPUT,
                    SingleTurnParams.ACTUAL_OUTPUT,
                    SingleTurnParams.RETRIEVAL_CONTEXT,
                ],
                threshold=REFUSAL_CORRECTNESS,
                model=judge,
                async_mode=False,  # GEval takes no include_reason: it always returns a reason
            )
        ]

    return [
        # The other metrics judge grounding in the retrieved chunks, not correctness: an answer built from the
        # wrong plan's chunk is perfectly "faithful". Only this one compares against the reference answer, and it
        # is what catches a misattributed figure (the pre-fix Premium 599 answer scored 1.0 on Faithfulness).
        GEval(
            name="Answer Correctness",
            criteria=CORRECTNESS_CRITERIA,
            evaluation_params=[
                SingleTurnParams.INPUT,
                SingleTurnParams.ACTUAL_OUTPUT,
                SingleTurnParams.EXPECTED_OUTPUT,
            ],
            threshold=ANSWER_CORRECTNESS,
            model=judge,
            async_mode=False,
        ),
        FaithfulnessMetric(threshold=FAITHFULNESS, **common),
        HallucinationMetric(threshold=HALLUCINATION, **common),
        AnswerRelevancyMetric(threshold=ANSWER_RELEVANCY, **common),
        ContextualPrecisionMetric(threshold=CONTEXTUAL_PRECISION, **common),
        ContextualRecallMetric(threshold=CONTEXTUAL_RECALL, **common),
    ]


@pytest.mark.parametrize("fixture", FIXTURES, ids=[f["query"][:50] for f in FIXTURES])
def test_rag_quality(fixture):
    test_case = LLMTestCase(
        input=fixture["query"],
        actual_output=fixture["answer"],
        expected_output=fixture["expected_output"],
        retrieval_context=fixture["retrieved_context"],
        # HallucinationMetric scores against `context`, not `retrieval_context`.
        context=fixture["retrieved_context"],
    )
    run_metrics(test_case, metrics_for(fixture), label=fixture["query"])
