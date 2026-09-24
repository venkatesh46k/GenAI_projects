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
