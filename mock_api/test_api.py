import pytest
from fastapi.testclient import TestClient

from mock_api import seed
from mock_api.main import app

MSISDN = "9876543210"

client = TestClient(app)


@pytest.fixture(autouse=True)
def fresh_db(tmp_path, monkeypatch):
    monkeypatch.setenv("BILLING_DB_PATH", str(tmp_path / "test.db"))
    seed.seed()


def test_get_balance_returns_seeded_data():
    r = client.get(f"/balance/{MSISDN}")
    assert r.status_code == 200
    assert r.json() == {"msisdn": MSISDN, "balance": 45.5, "plan_id": "PLAN_199", "status": "active"}


def test_balance_unknown_msisdn_404():
    assert client.get("/balance/0000000000").status_code == 404


def test_recharge_increases_balance():
    r = client.post("/recharge", json={"msisdn": MSISDN, "amount": 199, "plan_id": "PLAN_199"})
    assert r.status_code == 200
    body = r.json()
    assert body["new_balance"] == pytest.approx(244.5)
    assert body["txn_id"].startswith("TXN-")
    assert client.get(f"/balance/{MSISDN}").json()["balance"] == pytest.approx(244.5)


def test_recharge_invalid_msisdn_404_and_bad_amount_422():
    assert client.post("/recharge", json={"msisdn": "123", "amount": 99}).status_code == 404
    assert client.post("/recharge", json={"msisdn": MSISDN, "amount": -5}).status_code == 422


def test_plan_and_cdr_endpoints():
    assert client.get("/plans/PLAN_599").json()["price"] == 599.0
    assert client.get("/plans/NOPE").status_code == 404
    assert len(client.get(f"/cdr/{MSISDN}?limit=3").json()) == 3


def test_dispute_create_get_and_escalate():
    r = client.post("/dispute", json={"msisdn": MSISDN, "reason": "wrong charge", "amount_disputed": 50})
    assert r.status_code == 200
    did = r.json()["dispute_id"]
    assert did.startswith("D-")
    assert client.get(f"/dispute/{did}").json()["status"] == "open"

    esc = client.post(f"/dispute/{did}/escalate").json()
    assert esc["status"] == "escalated" and esc["ticket_id"].startswith("TCK-")
    assert client.get(f"/dispute/{did}").json()["status"] == "escalated"
    assert client.post("/dispute/D-nope/escalate").status_code == 404


def test_list_subscribers_returns_the_seeded_customers():
    rows = client.get("/subscribers").json()
    assert [r["msisdn"] for r in rows] == ["9123456780", "9876543210", "9988776655"]  # ordered by number
    first = next(r for r in rows if r["msisdn"] == MSISDN)
    assert first["balance"] == 45.5 and first["plan_id"] == "PLAN_199" and first["status"] == "active"
    assert len(client.get("/subscribers?limit=2").json()) == 2


def test_transactions_are_listed_newest_first_and_only_for_that_subscriber():
    assert client.get(f"/transactions/{MSISDN}").json() == []  # seed creates none
    client.post("/recharge", json={"msisdn": MSISDN, "amount": 10})
    client.post("/recharge", json={"msisdn": MSISDN, "amount": 20})
    client.post("/recharge", json={"msisdn": "9123456780", "amount": 5})
    txns = client.get(f"/transactions/{MSISDN}").json()
    assert [t["amount"] for t in txns] == [20.0, 10.0]
    assert txns[0]["balance_after"] == pytest.approx(75.5) and txns[0]["type"] == "recharge"
    assert len(client.get(f"/transactions/{MSISDN}?limit=1").json()) == 1


def test_transactions_for_an_unknown_subscriber_is_404():
    assert client.get("/transactions/0000000000").status_code == 404


def test_disputes_can_be_listed_all_or_filtered_by_number():
    everything = client.get("/disputes").json()
    assert {d["dispute_id"] for d in everything} == {"D-100001", "D-100002"}
    mine = client.get(f"/disputes?msisdn={MSISDN}").json()
    assert [d["dispute_id"] for d in mine] == ["D-100001"]
    assert mine[0]["msisdn"] == MSISDN and mine[0]["status"] == "open" and mine[0]["created_at"]
    assert client.get("/disputes?msisdn=0000000000").json() == []
