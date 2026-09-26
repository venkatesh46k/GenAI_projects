import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { openDb } from "../src/db.js";
import { seed } from "../src/seed.js";

const MSISDN = "9876543210";

let app: FastifyInstance;
let db: ReturnType<typeof openDb>;

beforeEach(() => {
  db = openDb(":memory:");
  seed(db);
  app = buildApp(db);
});

afterEach(async () => {
  await app.close();
  try {
    db.close();
  } catch {
    /* a test may have closed it on purpose */
  }
});

const get = (url: string) => app.inject({ method: "GET", url });
const post = (url: string, payload?: unknown) => app.inject({ method: "POST", url, payload: payload as never });
const recharge = (amount: number, msisdn = MSISDN, plan_id?: string) =>
  post("/recharge", { msisdn, amount, ...(plan_id ? { plan_id } : {}) });

describe("balance and plans", () => {
  it("returns the seeded balance", async () => {
    const res = await get(`/balance/${MSISDN}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ msisdn: MSISDN, balance: 45.5, plan_id: "PLAN_199", status: "active" });
  });

  it("404s for an unknown subscriber with the FastAPI-shaped detail", async () => {
    const res = await get("/balance/0000000000");
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ detail: "Subscriber not found" });
  });

  it("returns a plan, and 404s for an unknown one", async () => {
    expect((await get("/plans/PLAN_599")).json()).toMatchObject({ plan_id: "PLAN_599", price: 599, validity_days: 56 });
    expect((await get("/plans/NOPE")).statusCode).toBe(404);
  });
});

describe("recharge", () => {
  it("adds to the balance and records a transaction", async () => {
    const res = await recharge(199, MSISDN, "PLAN_199");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.new_balance).toBeCloseTo(244.5);
    expect(body.status).toBe("success");
    expect(body.txn_id).toMatch(/^TXN-[0-9a-f]{8}$/);
    expect((await get(`/balance/${MSISDN}`)).json().balance).toBeCloseTo(244.5);
    const txns = (await get(`/transactions/${MSISDN}`)).json();
    expect(txns).toHaveLength(1);
    expect(txns[0]).toMatchObject({ type: "recharge", amount: 199, balance_after: 244.5 });
  });

  it("switches the plan when one is given and keeps it when not", async () => {
    await recharge(10, MSISDN, "PLAN_599");
    expect((await get(`/balance/${MSISDN}`)).json().plan_id).toBe("PLAN_599");
    await recharge(10);
    expect((await get(`/balance/${MSISDN}`)).json().plan_id).toBe("PLAN_599");
  });

  it("does not accumulate floating-point noise", async () => {
    await recharge(0.1);
    const res = await recharge(0.2);
    expect(res.json().new_balance).toBe(45.8); // 45.6 + 0.2 is 45.800000000000004 in raw floating point
  });

  it("rejects an unknown subscriber and leaves no trace", async () => {
    const res = await recharge(99, "123");
    expect(res.statusCode).toBe(404);
    expect((db.prepare("SELECT COUNT(*) AS n FROM transactions").get() as { n: number }).n).toBe(0);
  });

  it.each([0, -5])("rejects a non-positive amount (%s) with 422", async (amount) => {
    const res = await recharge(amount);
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ detail: "Amount must be positive" });
    expect((await get(`/balance/${MSISDN}`)).json().balance).toBe(45.5);
  });

  it.each([
    ["a missing number", { amount: 10 }],
    ["a string amount", { msisdn: MSISDN, amount: "ten" }],
    ["an empty object", {}],
  ])("rejects %s with a 422 listing the problem", async (_label, payload) => {
    const res = await post("/recharge", payload);
    expect(res.statusCode).toBe(422);
    expect(Array.isArray(res.json().detail)).toBe(true);
    expect(res.json().detail[0]).toHaveProperty("loc");
  });

  it("rejects malformed JSON with a 422, not a 500", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/recharge",
      headers: { "content-type": "application/json" },
      payload: "{not json",
    });
    expect(res.statusCode).toBe(422);
  });

  it("handles many simultaneous recharges without losing any", async () => {
    const results = await Promise.all(Array.from({ length: 25 }, () => recharge(1)));
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    expect((await get(`/balance/${MSISDN}`)).json().balance).toBe(70.5);
    expect((await get(`/transactions/${MSISDN}?limit=100`)).json()).toHaveLength(25);
  });
});

describe("usage, transactions and subscribers", () => {
  it("returns CDRs newest first, honours the limit and never leaks the number", async () => {
    const all = (await get(`/cdr/${MSISDN}`)).json();
    expect(all).toHaveLength(10);
    expect(all[0]).not.toHaveProperty("msisdn");
    const times = all.map((c: { timestamp: string }) => c.timestamp);
    expect([...times].sort().reverse()).toEqual(times);
    expect((await get(`/cdr/${MSISDN}?limit=3`)).json()).toHaveLength(3);
  });

  it("returns an empty list of CDRs for an unknown number", async () => {
    expect((await get("/cdr/0000000000")).json()).toEqual([]);
  });

  it.each(["0", "-1", "501", "abc"])("rejects limit=%s with a 422", async (limit) => {
    expect((await get(`/cdr/${MSISDN}?limit=${limit}`)).statusCode).toBe(422);
  });

  it("lists transactions newest first even when two land in the same millisecond", async () => {
    await recharge(10);
    await recharge(20);
    await recharge(30);
    const amounts = (await get(`/transactions/${MSISDN}`)).json().map((t: { amount: number }) => t.amount);
    expect(amounts).toEqual([30, 20, 10]);
  });

  it("keeps each subscriber's transactions separate, and 404s for an unknown one", async () => {
    await recharge(5, "9123456780");
    expect((await get(`/transactions/${MSISDN}`)).json()).toEqual([]);
    expect((await get("/transactions/0000000000")).statusCode).toBe(404);
  });

  it("lists the seeded subscribers in number order, with a limit", async () => {
    const rows = (await get("/subscribers")).json();
    expect(rows.map((r: { msisdn: string }) => r.msisdn)).toEqual(["9123456780", "9876543210", "9988776655"]);
    expect(rows.find((r: { msisdn: string }) => r.msisdn === "9988776655").status).toBe("barred");
    expect((await get("/subscribers?limit=2")).json()).toHaveLength(2);
  });
});

describe("disputes", () => {
  it("creates, reads and escalates a dispute", async () => {
    const created = await post("/dispute", { msisdn: MSISDN, reason: "wrong charge", amount_disputed: 50 });
    expect(created.statusCode).toBe(200);
    const { dispute_id } = created.json();
    expect(dispute_id).toMatch(/^D-[0-9a-f]{6}$/);
    expect((await get(`/dispute/${dispute_id}`)).json()).toEqual({
      dispute_id,
      status: "open",
      reason: "wrong charge",
      amount_disputed: 50,
    });

    const escalated = (await post(`/dispute/${dispute_id}/escalate`)).json();
    expect(escalated).toMatchObject({ dispute_id, status: "escalated" });
    expect(escalated.ticket_id).toMatch(/^TCK-[0-9a-f]{6}$/);
    expect((await get(`/dispute/${dispute_id}`)).json().status).toBe("escalated");
  });

  it("escalates with an empty JSON body too (some clients send one)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/dispute/D-100001/escalate",
      headers: { "content-type": "application/json" },
      payload: "",
    });
    expect(res.statusCode).toBe(200);
  });

  it("404s for an unknown dispute", async () => {
    expect((await get("/dispute/D-nope")).statusCode).toBe(404);
    expect((await post("/dispute/D-nope/escalate")).statusCode).toBe(404);
  });

  it("refuses a dispute for a subscriber that does not exist", async () => {
    const res = await post("/dispute", { msisdn: "0000000000", reason: "x", amount_disputed: 1 });
    expect(res.statusCode).toBe(404);
    expect((await get("/disputes")).json()).toHaveLength(2); // still only the two seeded ones
  });

  it.each([
    ["an empty reason", { msisdn: MSISDN, reason: "", amount_disputed: 5 }],
    ["a negative amount", { msisdn: MSISDN, reason: "x", amount_disputed: -5 }],
    ["a missing amount", { msisdn: MSISDN, reason: "x" }],
  ])("rejects %s with a 422", async (_label, payload) => {
    expect((await post("/dispute", payload)).statusCode).toBe(422);
  });

  it("lists all disputes, or one customer's", async () => {
    const everything = (await get("/disputes")).json();
    expect(everything.map((d: { dispute_id: string }) => d.dispute_id).sort()).toEqual(["D-100001", "D-100002"]);
    const mine = (await get(`/disputes?msisdn=${MSISDN}`)).json();
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ dispute_id: "D-100001", msisdn: MSISDN, status: "open" });
    expect(mine[0].created_at).toBeTruthy();
    expect((await get("/disputes?msisdn=0000000000")).json()).toEqual([]);
  });
});

describe("service behaviour", () => {
  it("reports health", async () => {
    expect((await get("/health")).json()).toEqual({ status: "ok" });
  });

  it("answers unknown routes with the FastAPI-shaped Not Found (clients rely on it)", async () => {
    const res = await get("/no/such/route");
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ detail: "Not Found" });
  });

  it("returns a request id, and keeps the caller's when one is sent", async () => {
    expect((await get("/health")).headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    const res = await app.inject({ method: "GET", url: "/health", headers: { "x-request-id": "trace-me-123" } });
    expect(res.headers["x-request-id"]).toBe("trace-me-123");
  });

  it("turns an unexpected failure into a generic 500 that leaks nothing", async () => {
    db.close(); // every query now throws from inside SQLite
    const res = await get(`/balance/${MSISDN}`);
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ detail: "Internal Server Error" });
    expect(res.body.toLowerCase()).not.toContain("sqlite");
    expect(res.body.toLowerCase()).not.toContain("database");
  });

  it("re-seeding restores the starting data", async () => {
    await recharge(500);
    seed(db);
    expect((await get(`/balance/${MSISDN}`)).json().balance).toBe(45.5);
    expect((await get(`/transactions/${MSISDN}`)).json()).toEqual([]);
  });
});
