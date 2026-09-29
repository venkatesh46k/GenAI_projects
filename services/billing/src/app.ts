import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import Fastify, { type FastifyInstance, type FastifyServerOptions, type RouteHandlerMethod } from "fastify";
import type { z } from "zod";
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
import * as billing from "./service.js";

export function parse<S extends z.ZodType>(schema: S, data: unknown, where: "body" | "query"): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new HttpError(
      422,
      result.error.issues.map((issue) => ({ loc: [where, ...issue.path], msg: issue.message, type: issue.code })),
    );
  }
  return result.data;
}

/** Fastify options shared by both servers: request ids, a small body limit, and FastAPI-shaped error bodies. */
export function createServer(options: FastifyServerOptions = {}, notFound?: RouteHandlerMethod): FastifyInstance {
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

  app.setNotFoundHandler(notFound ?? ((_req, reply) => reply.code(404).send({ detail: "Not Found" })));

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

  return app;
}

/**
 * The INTERNAL billing API: the contract the agents and the contract tests use. It is unauthenticated on purpose
 * and must only be reachable from the same host (loopback); the browser never talks to it, it uses web.ts.
 */
export function buildApp(db: DatabaseSync, options: FastifyServerOptions = {}): FastifyInstance {
  const app = createServer(options);

  app.get("/health", async () => ({ status: "ok" }));

  app.get<{ Params: { msisdn: string } }>("/balance/:msisdn", async (req): Promise<BalanceResponse> => billing.getBalance(db, req.params.msisdn));

  app.get<{ Params: { plan_id: string } }>("/plans/:plan_id", async (req): Promise<PlanResponse> => billing.getPlan(db, req.params.plan_id));

  app.get("/subscribers", async (req): Promise<SubscriberItem[]> => {
    const { limit } = parse(SubscribersQuery, req.query, "query");
    return billing.listSubscribers(db, { limit });
  });

  app.post("/recharge", async (req): Promise<RechargeResponse> => billing.recharge(db, parse(RechargeBody, req.body, "body")));

  app.get<{ Params: { msisdn: string } }>("/cdr/:msisdn", async (req): Promise<CdrItem[]> => {
    const { limit } = parse(CdrQuery, req.query, "query");
    return billing.listCdrs(db, req.params.msisdn, limit);
  });

  app.get<{ Params: { msisdn: string } }>("/transactions/:msisdn", async (req): Promise<TransactionItem[]> => {
    const { limit } = parse(TransactionsQuery, req.query, "query");
    return billing.listTransactions(db, req.params.msisdn, limit);
  });

  app.post("/dispute", async (req): Promise<DisputeResponse> => billing.createDispute(db, parse(DisputeBody, req.body, "body")));

  app.get("/disputes", async (req): Promise<DisputeSummary[]> => {
    // Only msisdn/limit are part of the contract this internal API is tested against; a status filter is
    // console-only and lives on the public /api/disputes route instead.
    const { msisdn, limit } = parse(DisputesQuery, req.query, "query");
    return billing.listDisputes(db, { msisdn, limit });
  });

  app.get<{ Params: { dispute_id: string } }>("/dispute/:dispute_id", async (req): Promise<DisputeDetail> => billing.getDispute(db, req.params.dispute_id));

  app.post<{ Params: { dispute_id: string } }>(
    "/dispute/:dispute_id/escalate",
    async (req): Promise<EscalateResponse> => billing.escalateDispute(db, req.params.dispute_id),
  );

  return app;
}
