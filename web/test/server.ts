import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import type { CustomerOverview, PlanResponse, SubscriberItem } from "@contract/schemas";

export const SUBSCRIBERS: SubscriberItem[] = [
  { msisdn: "9876543210", plan_id: "P199", balance: 120.5, status: "active", last_recharge_date: "2026-09-01T10:00:00Z" },
  { msisdn: "9876500002", plan_id: "P99", balance: 2, status: "active", last_recharge_date: null },
  { msisdn: "9876500003", plan_id: null, balance: 0, status: "barred", last_recharge_date: null },
  { msisdn: "9876500004", plan_id: "P99", balance: 7, status: "active", last_recharge_date: null },
];

export const PLANS: PlanResponse[] = [
  { plan_id: "P99", name: "Basic", price: 99, validity_days: 28, data_per_day_gb: 1, voice_minutes: 100, sms_per_day: 100 },
  { plan_id: "P199", name: "Plus", price: 199, validity_days: 28, data_per_day_gb: 1.5, voice_minutes: 300, sms_per_day: 100 },
];

export function overviewFor(msisdn: string): CustomerOverview | null {
  const subscriber = SUBSCRIBERS.find((s) => s.msisdn === msisdn);
  if (!subscriber) return null;
  return {
    subscriber,
    plan: PLANS.find((p) => p.plan_id === subscriber.plan_id) ?? null,
    usage: [{ cdr_id: "C1", call_type: "voice", duration_sec: 125, data_mb: null, charge: 1.5, timestamp: "2026-09-10T09:00:00Z" }],
    transactions: [{ txn_id: "TXN1", type: "recharge", amount: 199, balance_after: 199, timestamp: "2026-09-01T10:00:00Z" }],
    disputes: [
      { dispute_id: "DSP-1", msisdn, amount_disputed: 50, reason: "Charged twice", status: "open", created_at: "2026-09-11T09:00:00Z" },
    ] as CustomerOverview["disputes"],
  };
}

/** Default handlers describe a signed-in user; individual tests override what they need with `server.use`. */
export const handlers = [
  http.get("/api/session", () => HttpResponse.json({ name: "Priya", role: "agent" })),
  http.post("/api/session", async ({ request }) => HttpResponse.json(await request.json())),
  http.delete("/api/session", () => new HttpResponse(null, { status: 204 })),
  http.get("/api/health", () => HttpResponse.json({ status: "ok", assistant: { status: "ok", ready: true, provider: "test", model: "test" } })),
  http.get("/api/plans", () => HttpResponse.json(PLANS)),
  http.get("/api/customers", ({ request }) => {
    const url = new URL(request.url);
    const q = url.searchParams.get("q") ?? "";
    const status = url.searchParams.get("status") ?? "";
    return HttpResponse.json(SUBSCRIBERS.filter((s) => s.msisdn.includes(q) && (!status || s.status === status)));
  }),
  http.get("/api/customers/:msisdn/overview", ({ params }) => {
    const data = overviewFor(String(params.msisdn));
    return data ? HttpResponse.json(data) : HttpResponse.json({ detail: "Subscriber not found" }, { status: 404 });
  }),
];

export const server = setupServer(...handlers);
