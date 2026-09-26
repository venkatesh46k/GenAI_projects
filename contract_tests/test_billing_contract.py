"""The billing API contract, checked over HTTP against whichever implementation is listening.

Two implementations exist (Python/FastAPI in mock_api/, Node/TypeScript in services/billing/). They must be
interchangeable: the agents, the console and the QA scenarios only know this contract. Run with:

    python -m contract_tests.run both          # seeds a temp database, starts each in turn, runs these tests

or by hand against a freshly seeded server:  CONTRACT_BASE_URL=http://127.0.0.1:8000 pytest contract_tests

Tests share one database, so each recharge test measures a delta instead of assuming an absolute balance.
"""
import os
import re

import pytest
import requests

BASE = os.getenv("CONTRACT_BASE_URL", "http://127.0.0.1:8000")
FRESH = "9988776655"  # seeded barred customer that no test recharges
ACTIVE = "9876543210"
OTHER = "9123456780"


def reachable() -> bool:
    try:
        return requests.get(f"{BASE}/subscribers", timeout=2).ok
    except requests.RequestException:
        return False


pytestmark = pytest.mark.skipif(not reachable(), reason=f"no billing service reachable at {BASE}")


def get(path, **kw):
    return requests.get(f"{BASE}{path}", timeout=10, **kw)


def post(path, body=None):
    return requests.post(f"{BASE}{path}", json=body, timeout=10) if body is not None else requests.post(f"{BASE}{path}", timeout=10)


def balance(msisdn):
    return get(f"/balance/{msisdn}").json()["balance"]


# ---------------------------------------------------------------- balance, plans


def test_balance_shape_and_seeded_values():
    r = get(f"/balance/{FRESH}")
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/json")
    assert r.json() == {"msisdn": FRESH, "balance": 5.0, "plan_id": "PLAN_199", "status": "barred"}


def test_unknown_subscriber_is_404_with_a_detail():
    r = get("/balance/0000000000")
    assert r.status_code == 404 and r.json() == {"detail": "Subscriber not found"}


def test_plan_lookup():
    plan = get("/plans/PLAN_599").json()
    assert plan == {
        "plan_id": "PLAN_599", "name": "Premium 599", "price": 599.0, "validity_days": 56,
        "data_per_day_gb": 2.5, "voice_minutes": 3000, "sms_per_day": 100,
    }
    r = get("/plans/NOPE")
    assert r.status_code == 404 and r.json() == {"detail": "Plan not found"}


def test_unknown_route_is_404_not_found():
    """Clients tell a missing route from a missing customer by this exact detail."""
    r = get("/definitely/not/a/route")
    assert r.status_code == 404 and r.json() == {"detail": "Not Found"}


# ---------------------------------------------------------------- recharge


def test_recharge_adds_to_the_balance_and_returns_a_transaction():
    before = balance(ACTIVE)
    r = post("/recharge", {"msisdn": ACTIVE, "amount": 199, "plan_id": "PLAN_199"})
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"txn_id", "new_balance", "status"} and body["status"] == "success"
    assert re.fullmatch(r"TXN-[0-9a-f]{8}", body["txn_id"])
    assert body["new_balance"] == pytest.approx(before + 199, abs=0.005)
    assert balance(ACTIVE) == pytest.approx(before + 199, abs=0.005)


def test_recharge_for_an_unknown_subscriber_is_404():
    assert post("/recharge", {"msisdn": "123", "amount": 99}).status_code == 404


@pytest.mark.parametrize("amount", [0, -5])
def test_a_non_positive_amount_is_422(amount):
    before = balance(ACTIVE)
    assert post("/recharge", {"msisdn": ACTIVE, "amount": amount}).status_code == 422
    assert balance(ACTIVE) == before


@pytest.mark.parametrize("body", [{}, {"amount": 10}, {"msisdn": ACTIVE, "amount": "ten"}])
def test_a_malformed_recharge_body_is_422(body):
    assert post("/recharge", body).status_code == 422


# ---------------------------------------------------------------- history


def test_transactions_are_newest_first_with_the_documented_fields():
    for amount in (10, 20, 30):
        assert post("/recharge", {"msisdn": OTHER, "amount": amount}).status_code == 200
    rows = get(f"/transactions/{OTHER}").json()
    assert [t["amount"] for t in rows[:3]] == [30, 20, 10]
    assert set(rows[0]) == {"txn_id", "type", "amount", "balance_after", "timestamp"} and rows[0]["type"] == "recharge"
    assert len(get(f"/transactions/{OTHER}?limit=1").json()) == 1


def test_transactions_for_an_unknown_subscriber_is_404():
    assert get("/transactions/0000000000").status_code == 404


def test_cdrs_shape_limit_and_order():
    rows = get(f"/cdr/{ACTIVE}?limit=3").json()
    assert len(rows) == 3
    assert set(rows[0]) == {"cdr_id", "call_type", "duration_sec", "data_mb", "charge", "timestamp"}
    stamps = [r["timestamp"] for r in get(f"/cdr/{ACTIVE}").json()]
    assert stamps == sorted(stamps, reverse=True)
    assert get("/cdr/0000000000").json() == []


def test_subscribers_are_listed_in_number_order_with_a_limit():
    rows = get("/subscribers").json()
    numbers = [r["msisdn"] for r in rows]
    assert numbers == sorted(numbers) and {OTHER, ACTIVE, FRESH} <= set(numbers)
    assert set(rows[0]) == {"msisdn", "plan_id", "balance", "status", "last_recharge_date"}
    assert len(get("/subscribers?limit=2").json()) == 2


# ---------------------------------------------------------------- disputes


def test_a_dispute_can_be_created_read_and_escalated():
    created = post("/dispute", {"msisdn": ACTIVE, "reason": "wrong charge", "amount_disputed": 50})
    assert created.status_code == 200 and created.json()["status"] == "open"
    did = created.json()["dispute_id"]
    assert re.fullmatch(r"D-[0-9a-f]{6}", did)

    assert get(f"/dispute/{did}").json() == {
        "dispute_id": did, "status": "open", "reason": "wrong charge", "amount_disputed": 50.0,
    }
    esc = post(f"/dispute/{did}/escalate").json()
    assert esc["dispute_id"] == did and esc["status"] == "escalated" and re.fullmatch(r"TCK-[0-9a-f]{6}", esc["ticket_id"])
    assert get(f"/dispute/{did}").json()["status"] == "escalated"


def test_unknown_disputes_are_404():
    assert get("/dispute/D-nope").status_code == 404
    assert post("/dispute/D-nope/escalate").status_code == 404


def test_a_dispute_for_an_unknown_subscriber_is_refused():
    r = post("/dispute", {"msisdn": "0000000000", "reason": "x", "amount_disputed": 1})
    assert r.status_code == 404 and r.json() == {"detail": "Subscriber not found"}


def test_disputes_can_be_listed_and_filtered():
    everything = {d["dispute_id"] for d in get("/disputes").json()}
    assert {"D-100001", "D-100002"} <= everything
    mine = get(f"/disputes?msisdn={OTHER}").json()
    assert [d["dispute_id"] for d in mine] == ["D-100002"]
    assert set(mine[0]) == {"dispute_id", "msisdn", "reason", "amount_disputed", "status", "created_at"}
    assert get("/disputes?msisdn=0000000000").json() == []
