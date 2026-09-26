import { randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import type { z } from "zod";
import { chatRoutes, type AiConfig } from "./chat.js";
import { all, get, run, transaction } from "./db.js";
import { HttpError } from "./errors.js";
import {
  CdrQuery,
  DisputeBody,
  DisputesQuery,
  RechargeBody,
  SubscribersQuery,
  TransactionsQuery,
  type BalanceResponse,
  type CdrItem,
  type DisputeDetail,
  type DisputeResponse,
  type DisputeSummary,
  type EscalateResponse,
  type PlanResponse,
  type RechargeResponse,
  type SubscriberItem,
  type TransactionItem,
} from "./schemas.js";

const hex = (bytes: number) => randomBytes(bytes).toString("hex");
const round2 = (value: number) => Math.round(value * 100) / 100;
const nowIso = () => new Date().toISOString();

function parse<S extends z.ZodType>(schema: S, data: unknown, where: "body" | "query"): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new HttpError(
      422,
      result.error.issues.map((issue) => ({ loc: [where, ...issue.path], msg: issue.message, type: issue.code })),
    );
  }
  return result.data;
}

/**
 * Build the billing API around an open database. Pure construction (no listening), so tests can drive it with
 * `app.inject(...)` and the server file only adds the network.
 */
export interface AppConfig {
  /** The AI service the chat routes forward to. Without it they answer 503 "not configured". */
  ai?: AiConfig;
}

export function buildApp(db: DatabaseSync, options: FastifyServerOptions = {}, config: AppConfig = {}): FastifyInstance {
  const app = Fastify({
    logger: false,
    requestIdHeader: "x-request-id",
    genReqId: () => randomUUID(),
    bodyLimit: 64 * 1024, // every request here is a small JSON document; refuse anything larger
    ...options,
  });

  // An empty body with a JSON content type is valid (POST /dispute/{id}/escalate takes none); bad JSON is a 422.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    try {
      done(null, body === "" ? {} : JSON.parse(body as string));
    } catch {
      done(new HttpError(422, "JSON decode error"), undefined);
    }
  });

  app.addHook("onSend", async (request, reply) => {
    reply.header("x-request-id", request.id); // lets a caller correlate its request with these logs
  });

  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ detail: "Not Found" }));

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) return reply.code(error.status).send({ detail: error.detail });
    // Client-side problems Fastify detects itself (rate limit, oversized body, wrong content type): a safe message.
    const status = (error as { statusCode?: number }).statusCode;
    if (typeof status === "number" && status >= 400 && status < 500) {
      const detail = status === 429 ? "Too many requests. Please slow down." : status === 413 ? "Request body too large" : "Bad request";
      return reply.code(status).send({ detail });
    }
    request.log.error({ err: error }, "unhandled error");
    return reply.code(500).send({ detail: "Internal Server Error" }); // never leak internals to the caller
  });

  app.get("/health", async () => ({ status: "ok" }));

  void app.register(chatRoutes(config.ai));

  // ------------------------------------------------------------------ subscribers, plans

  app.get<{ Params: { msisdn: string } }>("/balance/:msisdn", async (req): Promise<BalanceResponse> => {
    const row = get<BalanceResponse>(db, "SELECT msisdn, balance, plan_id, status FROM subscribers WHERE msisdn=?", req.params.msisdn);
    if (!row) throw new HttpError(404, "Subscriber not found");
    return row;
  });

  app.get<{ Params: { plan_id: string } }>("/plans/:plan_id", async (req): Promise<PlanResponse> => {
    const row = get<PlanResponse>(db, "SELECT * FROM plans WHERE plan_id=?", req.params.plan_id);
    if (!row) throw new HttpError(404, "Plan not found");
    return row;
  });

  app.get("/subscribers", async (req): Promise<SubscriberItem[]> => {
    const { limit } = parse(SubscribersQuery, req.query, "query");
    return all<SubscriberItem>(db, "SELECT * FROM subscribers ORDER BY msisdn LIMIT ?", limit);
  });

  // ------------------------------------------------------------------ recharge

  app.post("/recharge", async (req): Promise<RechargeResponse> => {
    const body = parse(RechargeBody, req.body, "body");
    if (!(body.amount > 0)) throw new HttpError(422, "Amount must be positive");

    const txnId = `TXN-${hex(4)}`;
    const now = nowIso();
    // Read-modify-write inside one transaction: two concurrent recharges can never overwrite each other's balance.
    const newBalance = transaction(db, () => {
      const sub = get<{ balance: number }>(db, "SELECT balance FROM subscribers WHERE msisdn=?", body.msisdn);
      if (!sub) throw new HttpError(404, "Subscriber not found");
      const updated = round2(sub.balance + body.amount);
      run(
        db,
        "UPDATE subscribers SET balance=?, plan_id=COALESCE(?, plan_id), last_recharge_date=? WHERE msisdn=?",
        updated,
        body.plan_id ?? null,
        now,
        body.msisdn,
      );
      run(db, "INSERT INTO transactions VALUES (?,?,?,?,?,?)", txnId, body.msisdn, "recharge", body.amount, updated, now);
      return updated;
    });
    return { txn_id: txnId, new_balance: newBalance, status: "success" };
  });

  // ------------------------------------------------------------------ usage and history

  app.get<{ Params: { msisdn: string } }>("/cdr/:msisdn", async (req): Promise<CdrItem[]> => {
    const { limit } = parse(CdrQuery, req.query, "query");
    // rowid breaks ties between records with the same timestamp, so the order is stable.
    return all<CdrItem>(
      db,
      "SELECT cdr_id, call_type, duration_sec, data_mb, charge, timestamp FROM cdrs WHERE msisdn=? ORDER BY timestamp DESC, rowid DESC LIMIT ?",
      req.params.msisdn,
      limit,
    );
  });

  app.get<{ Params: { msisdn: string } }>("/transactions/:msisdn", async (req): Promise<TransactionItem[]> => {
    const { limit } = parse(TransactionsQuery, req.query, "query");
    if (!get(db, "SELECT 1 FROM subscribers WHERE msisdn=?", req.params.msisdn)) {
      throw new HttpError(404, "Subscriber not found");
    }
    return all<TransactionItem>(
      db,
      "SELECT txn_id, type, amount, balance_after, timestamp FROM transactions WHERE msisdn=? ORDER BY timestamp DESC, rowid DESC LIMIT ?",
      req.params.msisdn,
      limit,
    );
  });

  // ------------------------------------------------------------------ disputes

  app.post("/dispute", async (req): Promise<DisputeResponse> => {
    const body = parse(DisputeBody, req.body, "body");
    if (!get(db, "SELECT 1 FROM subscribers WHERE msisdn=?", body.msisdn)) {
      throw new HttpError(404, "Subscriber not found"); // a dispute must belong to a real customer
    }
    const id = `D-${hex(3)}`;
    run(db, "INSERT INTO disputes VALUES (?,?,?,?,?,?)", id, body.msisdn, body.reason, body.amount_disputed, "open", nowIso());
    return { dispute_id: id, status: "open" };
  });

  app.get("/disputes", async (req): Promise<DisputeSummary[]> => {
    const { msisdn, limit } = parse(DisputesQuery, req.query, "query");
    return msisdn
      ? all<DisputeSummary>(db, "SELECT * FROM disputes WHERE msisdn=? ORDER BY created_at DESC, rowid DESC LIMIT ?", msisdn, limit)
      : all<DisputeSummary>(db, "SELECT * FROM disputes ORDER BY created_at DESC, rowid DESC LIMIT ?", limit);
  });

  app.get<{ Params: { dispute_id: string } }>("/dispute/:dispute_id", async (req): Promise<DisputeDetail> => {
    const row = get<DisputeDetail>(
      db,
      "SELECT dispute_id, status, reason, amount_disputed FROM disputes WHERE dispute_id=?",
      req.params.dispute_id,
    );
    if (!row) throw new HttpError(404, "Dispute not found");
    return row;
  });

  app.post<{ Params: { dispute_id: string } }>("/dispute/:dispute_id/escalate", async (req): Promise<EscalateResponse> => {
    const id = req.params.dispute_id;
    if (!get(db, "SELECT 1 FROM disputes WHERE dispute_id=?", id)) throw new HttpError(404, "Dispute not found");
    run(db, "UPDATE disputes SET status='escalated' WHERE dispute_id=?", id);
    return { dispute_id: id, status: "escalated", ticket_id: `TCK-${hex(3)}` };
  });

  return app;
}
