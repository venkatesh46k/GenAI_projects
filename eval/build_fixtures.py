"""Capture eval fixtures by running eval/questions.py through the real RAG agent.

Each fixture stores the query, the chunks actually retrieved from Chroma, and the answer the current
prompt + LLM produced, plus the hand-written reference answer. Re-run this after changing the RAG
prompt or model to measure the score delta:

    python -m eval.build_fixtures                          # rewrites eval/fixtures.jsonl
    python -m eval.build_fixtures eval/fixtures_new.jsonl  # write elsewhere, then EVAL_FIXTURES=... pytest eval

Run from the repo root. Uses ACTIVE_PROVIDER (see agents/llm.py).
"""
import json
import os
import sys
import warnings

warnings.filterwarnings("ignore")

from agents.llm import get_model_name, resolve_provider  # noqa: E402
from agents.rag_agent import rag_node  # noqa: E402
from eval.questions import QUESTIONS  # noqa: E402

DEFAULT_PATH = os.path.join(os.path.dirname(__file__), "fixtures.jsonl")


def build(path: str = DEFAULT_PATH) -> None:
    provider = resolve_provider()
    model = get_model_name(provider)
    with open(path, "w", encoding="utf-8") as f:
        for i, q in enumerate(QUESTIONS, 1):
            out = rag_node({"query": q["query"]})
            fixture = {
                "query": q["query"],
                "expected_output": q["expected_output"],
                "in_scope": q.get("in_scope", True),
                "retrieved_context": out["retrieved_context"],
                "answer": out["raw_answer"],
                "generated_by": f"{provider}:{model}",
            }
            f.write(json.dumps(fixture, ensure_ascii=False) + "\n")
            print(f"[{i}/{len(QUESTIONS)}] {q['query'][:60]}")
    print(f"Wrote {len(QUESTIONS)} fixtures to {path} (answers by {provider}:{model})")


if __name__ == "__main__":
    build(sys.argv[1] if len(sys.argv) > 1 else DEFAULT_PATH)
