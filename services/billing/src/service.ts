/**
 * Billing operations. The one implementation behind both servers: the internal API the agents call (app.ts) and the
 * public API the browser calls (web.ts). Functions take the open database and throw HttpError for client mistakes.
 */
import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { all, get, run, transaction } from "./db.js";
import { HttpError } from "./errors.js";
import type {
  AuditEntry,
  BalanceResponse,
  CdrItem,
  CustomerListItem,
  CustomerOverview,
  CustomerProfile,
  DashboardStats,
  DisputeDetail,
  DisputeSummary,
  EscalateResponse,
  NoteItem,
  PlanResponse,
  RechargeResponse,
  ReportStats,
  Role,
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

/** A new plan for the catalog. The id is chosen by whoever creates it (PLAN_249, not generated), like the demo
 * data's own plans, so it reads naturally in the rest of the console. */
export function createPlan(db: DatabaseSync, input: PlanResponse): PlanResponse {
  if (get(db, "SELECT 1 FROM plans WHERE plan_id=?", input.plan_id)) throw new HttpError(409, `Plan ${input.plan_id} already exists`);
  run(
    db,
    "INSERT INTO plans VALUES (?,?,?,?,?,?,?)",
    input.plan_id,
    input.name,
    input.price,
    input.validity_days,
    input.data_per_day_gb,
    input.voice_minutes,
    input.sms_per_day,
  );
  return input;
}

export function updatePlan(db: DatabaseSync, planId: string, input: Omit<PlanResponse, "plan_id">): PlanResponse {
  if (!get(db, "SELECT 1 FROM plans WHERE plan_id=?", planId)) throw new HttpError(404, "Plan not found");
  run(
    db,
    "UPDATE plans SET name=?, price=?, validity_days=?, data_per_day_gb=?, voice_minutes=?, sms_per_day=? WHERE plan_id=?",
    input.name,
    input.price,
    input.validity_days,
    input.data_per_day_gb,
    input.voice_minutes,
    input.sms_per_day,
    planId,
  );
  return { plan_id: planId, ...input };
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

export interface CustomerListFilter extends SubscriberFilter {
  /** Only customers that carry this tag. */
  tag?: string;
}

/** listSubscribers plus each customer's tags and profile, for the CRM-style list screen (never called by the
 * agents). `q` also matches a customer's name, so an agent can search "Ananya" as well as a phone number. */
export function listCustomersWithTags(db: DatabaseSync, filter: CustomerListFilter): CustomerListItem[] {
  const escaped = (filter.q ?? "").replace(/[\\%_]/g, (c) => `\\${c}`);
  const rows = all<SubscriberItem & CustomerProfile>(
    db,
    `SELECT DISTINCT s.*, p.name, p.email, p.city, p.segment FROM subscribers s
     LEFT JOIN customer_tags t ON t.msisdn = s.msisdn
     LEFT JOIN customer_profiles p ON p.msisdn = s.msisdn
     WHERE (? = '' OR s.msisdn LIKE ? ESCAPE '\\' OR p.name LIKE ? ESCAPE '\\')
       AND (? IS NULL OR s.status = ?)
       AND (? IS NULL OR t.tag = ?)
     ORDER BY s.msisdn LIMIT ?`,
    escaped,
    `%${escaped}%`,
    `%${escaped}%`,
    filter.status ?? null,
    filter.status ?? null,
    filter.tag ?? null,
    filter.tag ?? null,
    filter.limit,
  );
  return rows.map((row) => ({ ...row, tags: listTags(db, row.msisdn) }));
}

export function getProfile(db: DatabaseSync, msisdn: string): CustomerProfile | null {
  return get<CustomerProfile>(db, "SELECT name, email, city, segment FROM customer_profiles WHERE msisdn=?", msisdn) ?? null;
}

function subscriberExists(db: DatabaseSync, msisdn: string): boolean {
  return get(db, "SELECT 1 FROM subscribers WHERE msisdn=?", msisdn) !== undefined;
}

// ---------------------------------------------------------------- tags

export function listTags(db: DatabaseSync, msisdn: string): string[] {
  return all<{ tag: string }>(db, "SELECT tag FROM customer_tags WHERE msisdn=? ORDER BY tag", msisdn).map((row) => row.tag);
}

/** Every tag any customer has, for the list screen's filter menu. */
export function listAllTags(db: DatabaseSync): string[] {
  return all<{ tag: string }>(db, "SELECT DISTINCT tag FROM customer_tags ORDER BY tag").map((row) => row.tag);
}

export function addTag(db: DatabaseSync, msisdn: string, tag: string): string[] {
  if (!subscriberExists(db, msisdn)) throw new HttpError(404, "Subscriber not found");
  run(db, "INSERT OR IGNORE INTO customer_tags (msisdn, tag, created_at) VALUES (?,?,?)", msisdn, tag, nowIso());
  return listTags(db, msisdn);
}

export function removeTag(db: DatabaseSync, msisdn: string, tag: string): string[] {
  run(db, "DELETE FROM customer_tags WHERE msisdn=? AND tag=?", msisdn, tag);
  return listTags(db, msisdn);
}

// ---------------------------------------------------------------- notes

export function listNotes(db: DatabaseSync, msisdn: string, limit: number): NoteItem[] {
  return all<NoteItem>(db, "SELECT * FROM notes WHERE msisdn=? ORDER BY created_at DESC, rowid DESC LIMIT ?", msisdn, limit);
}

export function addNote(db: DatabaseSync, input: { msisdn: string; author_name: string; author_role: Role; text: string }): NoteItem {
  if (!subscriberExists(db, input.msisdn)) throw new HttpError(404, "Subscriber not found");
  const note: NoteItem = { note_id: `N-${hex(4)}`, msisdn: input.msisdn, author_name: input.author_name, author_role: input.author_role, text: input.text, created_at: nowIso() };
  run(db, "INSERT INTO notes VALUES (?,?,?,?,?,?)", note.note_id, note.msisdn, note.author_name, note.author_role, note.text, note.created_at);
  return note;
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

export interface DisputeFilter {
  msisdn?: string;
  status?: string;
  limit: number;
}

/** Lists disputes, newest first; `msisdn` narrows to one customer, `status` to one state, either or both or neither. */
export function listDisputes(db: DatabaseSync, { msisdn, status, limit }: DisputeFilter): DisputeSummary[] {
  return all<DisputeSummary>(
    db,
    `SELECT * FROM disputes WHERE (? IS NULL OR msisdn = ?) AND (? IS NULL OR status = ?) ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    msisdn ?? null,
    msisdn ?? null,
    status ?? null,
    status ?? null,
    limit,
  );
}

export function getDispute(db: DatabaseSync, id: string): DisputeDetail {
  const row = get<DisputeDetail>(db, "SELECT dispute_id, status, reason, amount_disputed FROM disputes WHERE dispute_id=?", id);
  if (!row) throw new HttpError(404, "Dispute not found");
  return row;
}

export function getDisputeMsisdn(db: DatabaseSync, id: string): string | null {
  return get<{ msisdn: string }>(db, "SELECT msisdn FROM disputes WHERE dispute_id=?", id)?.msisdn ?? null;
}

export function escalateDispute(db: DatabaseSync, id: string): EscalateResponse {
  if (!get(db, "SELECT 1 FROM disputes WHERE dispute_id=?", id)) throw new HttpError(404, "Dispute not found");
  run(db, "UPDATE disputes SET status='escalated' WHERE dispute_id=?", id);
  return { dispute_id: id, status: "escalated", ticket_id: `TCK-${hex(3)}` };
}

/** A team lead's final call on a dispute: resolved (the customer's claim was upheld) or rejected. */
export function resolveDispute(db: DatabaseSync, id: string, outcome: "resolved" | "rejected"): DisputeDetail {
  if (!get(db, "SELECT 1 FROM disputes WHERE dispute_id=?", id)) throw new HttpError(404, "Dispute not found");
  run(db, "UPDATE disputes SET status=? WHERE dispute_id=?", outcome, id);
  return getDispute(db, id);
}

/** Everything the Customer 360 screen shows, in one call instead of five. */
export function customerOverview(db: DatabaseSync, msisdn: string): CustomerOverview {
  const subscriber = get<SubscriberItem>(db, "SELECT * FROM subscribers WHERE msisdn=?", msisdn);
  if (!subscriber) throw new HttpError(404, "Subscriber not found");
  return {
    subscriber,
    profile: getProfile(db, msisdn),
    plan: subscriber.plan_id ? (get<PlanResponse>(db, "SELECT * FROM plans WHERE plan_id=?", subscriber.plan_id) ?? null) : null,
    usage: listCdrs(db, msisdn, 20),
    transactions: listTransactions(db, msisdn, 20),
    disputes: listDisputes(db, { msisdn, limit: 20 }),
    notes: listNotes(db, msisdn, 50),
    tags: listTags(db, msisdn),
  };
}

/** Cross-customer numbers for the dashboard: today's recharges, open/escalated disputes, and a 7-day revenue trend. */
export function dashboardStats(db: DatabaseSync): DashboardStats {
  const totals = get<{ customer_count: number; barred_count: number; total_balance: number }>(
    db,
    "SELECT COUNT(*) AS customer_count, SUM(status='barred') AS barred_count, COALESCE(SUM(balance),0) AS total_balance FROM subscribers",
  )!;
  const today = get<{ n: number; amount: number }>(
    db,
    "SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS amount FROM transactions WHERE type='recharge' AND date(timestamp)=date('now')",
  )!;
  const disputeCounts = get<{ open_disputes: number; escalated_disputes: number }>(
    db,
    "SELECT SUM(status='open') AS open_disputes, SUM(status='escalated') AS escalated_disputes FROM disputes",
  )!;
  const byDay = all<{ date: string; amount: number }>(
    db,
    `SELECT date(timestamp) AS date, SUM(amount) AS amount FROM transactions
     WHERE type='recharge' AND date(timestamp) > date('now', '-7 days')
     GROUP BY date(timestamp) ORDER BY date(timestamp)`,
  );
  // SQLite's date('now') is UTC; a day with no recharges is just missing from byDay, so the chart fills every day in.
  const byDate = new Map(byDay.map((row) => [row.date, round2(row.amount)]));
  const revenueLast7Days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(Date.now() - (6 - i) * 86_400_000).toISOString().slice(0, 10);
    return { date, amount: byDate.get(date) ?? 0 };
  });
  return {
    customer_count: totals.customer_count,
    barred_count: totals.barred_count ?? 0,
    total_balance: round2(totals.total_balance),
    today_recharge_count: today.n,
    today_recharge_amount: round2(today.amount),
    open_disputes: disputeCounts.open_disputes ?? 0,
    escalated_disputes: disputeCounts.escalated_disputes ?? 0,
    revenue_last_7_days: revenueLast7Days,
  };
}

// ---------------------------------------------------------------- audit log

/** One line in the audit log: who did what, and to which customer if any. Called after a mutation succeeds, never
 * on the failure path (a failed attempt is not an event that happened). */
export function recordAudit(db: DatabaseSync, input: { actor_name: string; actor_role: Role; action: string; msisdn?: string | null; detail?: string | null }): void {
  run(
    db,
    "INSERT INTO audit_log VALUES (?,?,?,?,?,?,?)",
    `A-${hex(5)}`,
    nowIso(),
    input.actor_name,
    input.actor_role,
    input.action,
    input.msisdn ?? null,
    input.detail ?? null,
  );
}

export function listAudit(db: DatabaseSync, filter: { msisdn?: string; action?: string; limit: number }): AuditEntry[] {
  return all<AuditEntry>(
    db,
    `SELECT * FROM audit_log WHERE (? IS NULL OR msisdn = ?) AND (? IS NULL OR action = ?) ORDER BY at DESC, rowid DESC LIMIT ?`,
    filter.msisdn ?? null,
    filter.msisdn ?? null,
    filter.action ?? null,
    filter.action ?? null,
    filter.limit,
  );
}

/** Every distinct action ever logged, for the audit page's filter menu. */
export function listAuditActions(db: DatabaseSync): string[] {
  return all<{ action: string }>(db, "SELECT DISTINCT action FROM audit_log ORDER BY action").map((row) => row.action);
}

// ---------------------------------------------------------------- reports

/** Aggregate numbers for the Reports page: how customers spread across plans, a revenue trend over `days`, and
 * usage totals by type over the same window. A superset of the dashboard's 7-day view, at a chosen period. */
export function reportStats(db: DatabaseSync, days: 7 | 30 | 90): ReportStats {
  const planDistribution = all<{ plan_id: string; name: string; customers: number }>(
    db,
    `SELECT p.plan_id, p.name, COUNT(s.msisdn) AS customers FROM plans p
     LEFT JOIN subscribers s ON s.plan_id = p.plan_id
     GROUP BY p.plan_id ORDER BY p.price`,
  );
  const byDay = all<{ date: string; amount: number }>(
    db,
    `SELECT date(timestamp) AS date, SUM(amount) AS amount FROM transactions
     WHERE type='recharge' AND date(timestamp) > date('now', ?)
     GROUP BY date(timestamp) ORDER BY date(timestamp)`,
    `-${days} days`,
  );
  const byDate = new Map(byDay.map((row) => [row.date, round2(row.amount)]));
  const revenueTrend = Array.from({ length: days }, (_, i) => {
    const date = new Date(Date.now() - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10);
    return { date, amount: byDate.get(date) ?? 0 };
  });
  const usageByType = all<{ call_type: string; count: number; total_charge: number }>(
    db,
    `SELECT call_type, COUNT(*) AS count, COALESCE(SUM(charge),0) AS total_charge FROM cdrs
     WHERE date(timestamp) > date('now', ?) GROUP BY call_type ORDER BY call_type`,
    `-${days} days`,
  );
  return {
    plan_distribution: planDistribution,
    revenue_trend: revenueTrend,
    usage_by_type: usageByType.map((row) => ({ ...row, total_charge: round2(row.total_charge) })),
    days,
  };
}
