"""Run DeepEval metrics one by one, record every result, and assert with a readable message.

Why not assert_test(): it evaluates concurrently, prints nothing until every metric finishes, and reports
one aggregated exception. A long run against a slow or rate-limited judge is opaque that way. Here each
metric's score, threshold, verdict, reason and judge is appended to eval/results/latest.jsonl the moment it
is known.

Resumable (EVAL_RESUME=1): free-tier judges have daily quotas, so a full run may need several sessions. A
metric already recorded as passing for the same test AND the same answer/context is skipped, so re-running
only spends judge calls on what is missing or failed. Changing the answer, its retrieved context or the
reference answer changes the fingerprint, so stale passes are never reused.
"""
import hashlib
import json
import os
from datetime import datetime, timezone

import pytest

from eval.judge import get_judge, is_quota_error

RESULTS_DIR = os.path.join(os.path.dirname(__file__), "results")
RESULTS_PATH = os.path.join(RESULTS_DIR, "latest.jsonl")


def fingerprint(test_case) -> str:
    material = json.dumps(
        [test_case.input, test_case.actual_output, test_case.expected_output, test_case.retrieval_context or []],
        ensure_ascii=False,
    )
    return hashlib.sha1(material.encode("utf-8")).hexdigest()[:12]


def _record(row: dict) -> None:
    os.makedirs(RESULTS_DIR, exist_ok=True)
    with open(RESULTS_PATH, "a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")


def _already_passed(label: str, metric: str, fp: str) -> bool:
    if not os.getenv("EVAL_RESUME") or not os.path.exists(RESULTS_PATH):
        return False
    with open(RESULTS_PATH, encoding="utf-8") as f:
        for line in f:
            row = json.loads(line)
            if row["test"] == label and row["metric"] == metric and row.get("fingerprint") == fp and row["success"]:
                return True
    return False


def run_metrics(test_case, metrics, label: str) -> None:
    fp = fingerprint(test_case)
    judge = get_judge().get_model_name()
    failures = []
    for metric in metrics:
        if _already_passed(label, metric.__name__, fp):
            continue
        row = {
            "time": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "test": label,
            "metric": metric.__name__,
            "threshold": metric.threshold,
            "judge": judge,
            "fingerprint": fp,
        }
        try:
            metric.measure(test_case)
            row.update(score=metric.score, success=bool(metric.is_successful()), reason=metric.reason)
        except Exception as exc:
            if is_quota_error(exc):
                _record({**row, "success": False, "error": f"JUDGE QUOTA EXHAUSTED: {exc}"})
                pytest.exit(f"Judge quota exhausted, stopping the run: {str(exc)[:200]}", returncode=3)
            row.update(score=None, success=False, error=f"{type(exc).__name__}: {str(exc)[:300]}")
        _record(row)
        if not row["success"]:
            detail = row.get("error") or row.get("reason")
            failures.append(f"{row['metric']}: score {row['score']} vs threshold {row['threshold']} - {detail}")

    assert not failures, "\n".join(failures)
