"""Routing accuracy check: 15 hand-written queries (3 per agent) through the real router.

Needs Ollama running for queries that fall through to the LLM classifier.
Run from the repo root:  python -m agents.routing_check
Writes logs/routing_check.csv and prints per-route accuracy.
"""
import csv
import os
from collections import defaultdict

from agents.router import router_node

CASES = [
    ("What is the grace period after my plan expires?", "rag"),
    ("How is the charge in a CDR calculated?", "rag"),
    ("Are incoming calls free while roaming in India?", "rag"),
    ("What's my balance for 9876543210?", "balance"),
    ("Recharge 9123456780 with 599", "balance"),
    ("Show plan details for 9988776655", "balance"),
    ("I was charged twice for my recharge on 9876543210", "dispute"),
    ("I want a refund for the wrong charge on 9123456780", "dispute"),
    ("There is an overcharge on my bill", "dispute"),
    ("Escalate my complaint about 9876543210", "escalation"),
    ("I want to speak to a manager", "escalation"),
    ("Please file a case, nobody is helping me", "escalation"),
    ("Verify that recharging 199 updates the balance", "testgen"),
    ("Test that the confirmation page shows the exact amount", "testgen"),
    ("Check that an invalid number is rejected on the recharge page", "testgen"),
]

CSV_PATH = os.path.join(os.path.dirname(__file__), "..", "logs", "routing_check.csv")


def run():
    rows = []
    for query, expected in CASES:
        out = router_node({"query": query})
        rows.append(
            {
                "query": query,
                "expected": expected,
                "actual": out["route"],
                "method": out["route_method"],
                "correct": out["route"] == expected,
            }
        )

    os.makedirs(os.path.dirname(CSV_PATH), exist_ok=True)
    with open(CSV_PATH, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)

    per_route = defaultdict(lambda: [0, 0])
    for r in rows:
        per_route[r["expected"]][1] += 1
        per_route[r["expected"]][0] += r["correct"]
    for r in rows:
        mark = "ok  " if r["correct"] else "MISS"
        print(f"{mark} [{r['method']:5}] expected={r['expected']:10} actual={r['actual']:10} | {r['query']}")
    print()
    for route, (ok, total) in per_route.items():
        print(f"{route:10} {ok}/{total}")
    total_ok = sum(r["correct"] for r in rows)
    print(f"{'overall':10} {total_ok}/{len(rows)}  -> {CSV_PATH}")


if __name__ == "__main__":
    run()
