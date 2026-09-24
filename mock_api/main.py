import uuid
from datetime import datetime

from fastapi import FastAPI, HTTPException

from mock_api.db import get_connection
from mock_api.models import (
    BalanceResponse,
    CDRItem,
    DisputeDetail,
    DisputeRequest,
    DisputeResponse,
    EscalateResponse,
    PlanResponse,
    RechargeRequest,
    RechargeResponse,
)

app = FastAPI(title="Prepaid Billing Mock API")


@app.get("/balance/{msisdn}", response_model=BalanceResponse)
def get_balance(msisdn: str):
    conn = get_connection()
    row = conn.execute("SELECT * FROM subscribers WHERE msisdn=?", (msisdn,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Subscriber not found")
    return BalanceResponse(
        msisdn=row["msisdn"], balance=row["balance"], plan_id=row["plan_id"], status=row["status"]
    )


@app.get("/plans/{plan_id}", response_model=PlanResponse)
def get_plan(plan_id: str):
    conn = get_connection()
    row = conn.execute("SELECT * FROM plans WHERE plan_id=?", (plan_id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Plan not found")
    return PlanResponse(**dict(row))


@app.post("/recharge", response_model=RechargeResponse)
def recharge(req: RechargeRequest):
    if req.amount <= 0:
        raise HTTPException(status_code=422, detail="Amount must be positive")
    conn = get_connection()
    row = conn.execute("SELECT * FROM subscribers WHERE msisdn=?", (req.msisdn,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Subscriber not found")
    new_balance = row["balance"] + req.amount

    now = datetime.now().isoformat()
    txn_id = f"TXN-{uuid.uuid4().hex[:8]}"
    conn.execute(
        "UPDATE subscribers SET balance=?, plan_id=COALESCE(?, plan_id), last_recharge_date=? WHERE msisdn=?",
        (new_balance, req.plan_id, now, req.msisdn),
    )
    conn.execute(
        "INSERT INTO transactions VALUES (?,?,?,?,?,?)",
        (txn_id, req.msisdn, "recharge", req.amount, new_balance, now),
    )
    conn.commit()
    conn.close()
    return RechargeResponse(txn_id=txn_id, new_balance=new_balance, status="success")


@app.get("/cdr/{msisdn}", response_model=list[CDRItem])
def get_cdrs(msisdn: str, limit: int = 10):
    conn = get_connection()
    rows = conn.execute(
        "SELECT * FROM cdrs WHERE msisdn=? ORDER BY timestamp DESC LIMIT ?", (msisdn, limit)
    ).fetchall()
    conn.close()
    return [CDRItem(**dict(r)) for r in rows]


@app.post("/dispute", response_model=DisputeResponse)
def create_dispute(req: DisputeRequest):
    dispute_id = f"D-{uuid.uuid4().hex[:6]}"
    conn = get_connection()
    conn.execute(
        "INSERT INTO disputes VALUES (?,?,?,?,?,?)",
        (dispute_id, req.msisdn, req.reason, req.amount_disputed, "open", datetime.now().isoformat()),
    )
    conn.commit()
    conn.close()
    return DisputeResponse(dispute_id=dispute_id, status="open")


@app.get("/dispute/{dispute_id}", response_model=DisputeDetail)
def get_dispute(dispute_id: str):
    conn = get_connection()
    row = conn.execute("SELECT * FROM disputes WHERE dispute_id=?", (dispute_id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Dispute not found")
    return DisputeDetail(**dict(row))


@app.post("/dispute/{dispute_id}/escalate", response_model=EscalateResponse)
def escalate_dispute(dispute_id: str):
    conn = get_connection()
    row = conn.execute("SELECT * FROM disputes WHERE dispute_id=?", (dispute_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Dispute not found")
    ticket_id = f"TCK-{uuid.uuid4().hex[:6]}"
    conn.execute("UPDATE disputes SET status='escalated' WHERE dispute_id=?", (dispute_id,))
    conn.commit()
    conn.close()
    return EscalateResponse(dispute_id=dispute_id, status="escalated", ticket_id=ticket_id)
