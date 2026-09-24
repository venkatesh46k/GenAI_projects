import os

import pytest

from rag.retriever import get_retriever

# One natural-language query per source doc; the doc's chunk must appear in the top-4.
QUERIES = {
    "cdr_spec.md": "What fields does a call detail record contain?",
    "rating_plan_basic.md": "What are the data and voice benefits of the 199 plan?",
    "rating_plan_premium.md": "What extra benefits does the 599 premium plan have?",
    "rating_plan_topup.md": "Can I buy a data top-up pack without a base plan?",
    "dispute_resolution_sop.md": "What is the SLA for resolving a billing dispute and when to escalate?",
    "trai_prepaid_summary.md": "What do TRAI regulations say about prepaid plan validity?",
    "recharge_policy.md": "What happens when a recharge fails or is only a partial amount?",
    "roaming_charges.md": "Are incoming calls free while roaming in India?",
    "plan_validity_expiry.md": "What is the grace period after my plan expires?",
    "low_balance_barring.md": "At what balance are outgoing calls barred?",
    "refund_policy.md": "How long does a refund to my payment source take?",
    "faq.md": "How do I check my balance and raise a dispute?",
}


@pytest.fixture(scope="module")
def retriever():
    return get_retriever(k=4)


@pytest.mark.parametrize("doc,query", QUERIES.items())
def test_query_retrieves_expected_doc(retriever, doc, query):
    sources = [os.path.basename(d.metadata["source"]) for d in retriever.invoke(query)]
    assert doc in sources, f"{doc} not in top-4 for {query!r}; got {sources}"
