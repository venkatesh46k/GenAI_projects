/**
 * Billing operations. The one implementation behind both servers: the internal API the agents call (app.ts) and the
 * public API the browser calls (web.ts). Functions take the open database and throw HttpError for client mistakes.
 */
import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { all, get, run, transaction } from "./db.js";
import { HttpError } from "./errors.js";
import type {
  BalanceResponse,
  CdrItem,
  CustomerOverview,
  DisputeDetail,
  DisputeSummary,
  EscalateResponse,
  PlanResponse,
  RechargeResponse,
  SubscriberItem,
  TransactionItem,
} from "./schemas.js";

const hex = (bytes: number) => randomBytes(bytes).toString("hex");
const round2 = (value: number) => Math.round(value * 100) / 100;
const nowIso = () => new Date().toISOString();

export function getBalance(db: DatabaseSync, msisdn: string): BalanceResponse {
  const row = get<BalanceResponse>(db, "SELECT msisdn, balance, plan_id, status FROM subscribers WHERE msisdn=?", msisdn);
  if (!row) throw new HttpError(404, "Subscriber not found");
  return row;
}

export function getPlan(db: DatabaseSync, planId: string): PlanResponse {
  const row = get<PlanResponse>(db, "SELECT * FROM plans WHERE plan_id=?", planId);
  if (!row) throw new HttpError(404, "Plan not found");
  return row;
}

export function listPlans(db: DatabaseSync): PlanResponse[] {
  return all<PlanResponse>(db, "SELECT * FROM plans ORDER BY price");
}

export interface SubscriberFilter {
  limit: number;
  /** Substring of the number. */
  q?: string;
  status?: string;
}

export function listSubscribers(db: DatabaseSync, { limit, q, status }: SubscriberFilter): SubscriberItem[] {
  // LIKE metacharacters in the search text are escaped: a user typing "%" must not match everything.
  const escaped = (q ?? "").replace(/[\\%_]/g, (c) => `\\${c}`);
  return all<SubscriberItem>(
    db,
    "SELECT * FROM subscribers WHERE (? = '' OR msisdn LIKE ? ESCAPE '\\') AND (? IS NULL OR status = ?) ORDER BY msisdn LIMIT ?",
    escaped,
    `%${escaped}%`,
    status ?? null,
    status ?? null,
    limit,
  );
}

function subscriberExists(db: DatabaseSync, msisdn: string): boolean {
  return get(db, "SELECT 1 FROM subscribers WHERE msisdn=?", msisdn) !== undefined;
}

export function recharge(db: DatabaseSync, input: { msisdn: string; amount: number; plan_id?: string | null }): RechargeResponse {
  if (!(input.amount > 0)) throw new HttpError(422, "Amount must be positive");
  const txnId = `TXN-${hex(4)}`;
  const now = nowIso();
  // Read-modify-write inside one transaction: two concurrent recharges can never overwrite each other's balance.
  const newBalance = transaction(db, () => {
    const sub = get<{ balance: number }>(db, "SELECT balance FROM subscribers WHERE msisdn=?", input.msisdn);
    if (!sub) throw new HttpError(404, "Subscriber not found");
    const updated = round2(sub.balance + input.amount);
    run(
      db,
      "UPDATE subscribers SET balance=?, plan_id=COALESCE(?, plan_id), last_recharge_date=? WHERE msisdn=?",
      updated,
      input.plan_id ?? null,
      now,
      input.msisdn,
    );
    run(db, "INSERT INTO transactions VALUES (?,?,?,?,?,?)", txnId, input.msisdn, "recharge", input.amount, updated, now);
    return updated;
  });
  return { txn_id: txnId, new_balance: newBalance, status: "success" };
}

export function listCdrs(db: DatabaseSync, msisdn: string, limit: number): CdrItem[] {
  // rowid breaks ties between records with the same timestamp, so the order is stable.
  return all<CdrItem>(
    db,
    "SELECT cdr_id, call_type, duration_sec, data_mb, charge, timestamp FROM cdrs WHERE msisdn=? ORDER BY timestamp DESC, rowid DESC LIMIT ?",
    msisdn,
    limit,
  );
}

export function listTransactions(db: DatabaseSync, msisdn: string, limit: number): TransactionItem[] {
  if (!subscriberExists(db, msisdn)) throw new HttpError(404, "Subscriber not found");
  return all<TransactionItem>(
    db,
    "SELECT txn_id, type, amount, balance_after, timestamp FROM transactions WHERE msisdn=? ORDER BY timestamp DESC, rowid DESC LIMIT ?",
    msisdn,
    limit,
  );
}

export function createDispute(db: DatabaseSync, input: { msisdn: string; reason: string; amount_disputed: number }) {
  if (!subscriberExists(db, input.msisdn)) throw new HttpError(404, "Subscriber not found"); // must belong to a real customer
  const id = `D-${hex(3)}`;
  run(db, "INSERT INTO disputes VALUES (?,?,?,?,?,?)", id, input.msisdn, input.reason, input.amount_disputed, "open", nowIso());
  return { dispute_id: id, status: "open" };
}

export function listDisputes(db: DatabaseSync, msisdn: string | undefined, limit: number): DisputeSummary[] {
  return msisdn
    ? all<DisputeSummary>(db, "SELECT * FROM disputes WHERE msisdn=? ORDER BY created_at DESC, rowid DESC LIMIT ?", msisdn, limit)
    : all<DisputeSummary>(db, "SELECT * FROM disputes ORDER BY created_at DESC, rowid DESC LIMIT ?", limit);
}

export function getDispute(db: DatabaseSync, id: string): DisputeDetail {
  const row = get<DisputeDetail>(db, "SELECT dispute_id, status, reason, amount_disputed FROM disputes WHERE dispute_id=?", id);
  if (!row) throw new HttpError(404, "Dispute not found");
  return row;
}

export function escalateDispute(db: DatabaseSync, id: string): EscalateResponse {
  if (!get(db, "SELECT 1 FROM disputes WHERE dispute_id=?", id)) throw new HttpError(404, "Dispute not found");
  run(db, "UPDATE disputes SET status='escalated' WHERE dispute_id=?", id);
  return { dispute_id: id, status: "escalated", ticket_id: `TCK-${hex(3)}` };
}

/** Everything the Customer 360 screen shows, in one call instead of five. */
export function customerOverview(db: DatabaseSync, msisdn: string): CustomerOverview {
  const subscriber = get<SubscriberItem>(db, "SELECT * FROM subscribers WHERE msisdn=?", msisdn);
  if (!subscriber) throw new HttpError(404, "Subscriber not found");
  return {
    subscriber,
    plan: subscriber.plan_id ? (get<PlanResponse>(db, "SELECT * FROM plans WHERE plan_id=?", subscriber.plan_id) ?? null) : null,
    usage: listCdrs(db, msisdn, 20),
    transactions: listTransactions(db, msisdn, 20),
    disputes: listDisputes(db, msisdn, 20),
  };
}
