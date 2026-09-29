import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import type { AuditEntry, CustomerOverview, CustomerProfile, DashboardStats, DisputeSummary, NoteItem, PlanResponse, ReportStats, SubscriberItem } from "@contract/schemas";

export const SUBSCRIBERS: SubscriberItem[] = [
  { msisdn: "9876543210", plan_id: "P199", balance: 120.5, status: "active", last_recharge_date: "2026-09-01T10:00:00Z" },
  { msisdn: "9876500002", plan_id: "P99", balance: 2, status: "active", last_recharge_date: null },
  { msisdn: "9876500003", plan_id: null, balance: 0, status: "barred", last_recharge_date: null },
  { msisdn: "9876500004", plan_id: "P99", balance: 7, status: "active", last_recharge_date: null },
];

export const PROFILES: Record<string, CustomerProfile> = {
  "9876543210": { name: "Ananya Sharma", email: "ananya.sharma@example.test", city: "Pune", segment: "Individual" },
};

const initialPlans = (): PlanResponse[] => [
  { plan_id: "P99", name: "Basic", price: 99, validity_days: 28, data_per_day_gb: 1, voice_minutes: 100, sms_per_day: 100 },
  { plan_id: "P199", name: "Plus", price: 199, validity_days: 28, data_per_day_gb: 1.5, voice_minutes: 300, sms_per_day: 100 },
];
export let PLANS: PlanResponse[] = initialPlans();

const initialDisputes = (): DisputeSummary[] => [
  { dispute_id: "DSP-1", msisdn: "9876543210", amount_disputed: 50, reason: "Charged twice", status: "open", created_at: "2026-09-11T09:00:00Z" },
  { dispute_id: "DSP-2", msisdn: "9876500002", amount_disputed: 20, reason: "Wrong plan applied", status: "escalated", created_at: "2026-09-12T09:00:00Z" },
  { dispute_id: "DSP-3", msisdn: "9876500003", amount_disputed: 10, reason: "Data not credited", status: "resolved", created_at: "2026-09-09T09:00:00Z" },
];

const DASHBOARD: DashboardStats = {
  customer_count: SUBSCRIBERS.length,
  barred_count: 1,
  total_balance: 129.5,
  today_recharge_count: 2,
  today_recharge_amount: 298,
  open_disputes: 1,
  escalated_disputes: 1,
  revenue_last_7_days: Array.from({ length: 7 }, (_, i) => ({ date: `2026-09-2${i}`, amount: i * 25 })),
};

const REPORTS: Record<7 | 30 | 90, ReportStats> = {
  7: {
    days: 7,
    plan_distribution: [
      { plan_id: "P99", name: "Basic", customers: 2 },
      { plan_id: "P199", name: "Plus", customers: 1 },
    ],
    revenue_trend: Array.from({ length: 7 }, (_, i) => ({ date: `2026-09-2${i}`, amount: i * 25 })),
    usage_by_type: [
      { call_type: "voice", count: 40, total_charge: 120.5 },
      { call_type: "data", count: 30, total_charge: 88.25 },
      { call_type: "sms", count: 20, total_charge: 40 },
    ],
  },
  30: {
    days: 30,
    plan_distribution: [
      { plan_id: "P99", name: "Basic", customers: 2 },
      { plan_id: "P199", name: "Plus", customers: 1 },
    ],
    revenue_trend: Array.from({ length: 30 }, (_, i) => ({ date: `2026-08-${String(i + 1).padStart(2, "0")}`, amount: (i % 5) * 40 })),
    usage_by_type: [
      { call_type: "voice", count: 160, total_charge: 480.5 },
      { call_type: "data", count: 120, total_charge: 350.25 },
      { call_type: "sms", count: 80, total_charge: 160 },
    ],
  },
  90: { days: 90, plan_distribution: [], revenue_trend: [], usage_by_type: [] },
};

const AUDIT: AuditEntry[] = [
  { id: "A-1", at: "2026-09-29T10:00:00Z", actor_name: "Priya", actor_role: "agent", action: "recharge", msisdn: "9876543210", detail: "₹199.00 · new balance ₹319.50 · TXN-1" },
  { id: "A-2", at: "2026-09-29T09:00:00Z", actor_name: "Lead L", actor_role: "team_lead", action: "dispute_escalated", msisdn: "9876500002", detail: "DSP-2 · TCK-1" },
  { id: "A-3", at: "2026-09-28T09:00:00Z", actor_name: "Priya", actor_role: "agent", action: "tag_added", msisdn: "9876543210", detail: "VIP" },
];

/** Mutable fixture state (tags, notes, disputes, plans). `resetFixtures()` restores all of it between tests. */
export let TAGS: Record<string, string[]> = {};
export let NOTES: Record<string, NoteItem[]> = {};
export let DISPUTES: DisputeSummary[] = initialDisputes();

export function resetFixtures() {
  TAGS = {};
  NOTES = {};
  DISPUTES = initialDisputes();
  PLANS = initialPlans();
}

export function overviewFor(msisdn: string): CustomerOverview | null {
  const subscriber = SUBSCRIBERS.find((s) => s.msisdn === msisdn);
  if (!subscriber) return null;
  return {
    subscriber,
    profile: PROFILES[msisdn] ?? null,
    plan: PLANS.find((p) => p.plan_id === subscriber.plan_id) ?? null,
    usage: [{ cdr_id: "C1", call_type: "voice", duration_sec: 125, data_mb: null, charge: 1.5, timestamp: "2026-09-10T09:00:00Z" }],
    transactions: [{ txn_id: "TXN1", type: "recharge", amount: 199, balance_after: 199, timestamp: "2026-09-01T10:00:00Z" }],
    disputes: DISPUTES.filter((d) => d.msisdn === msisdn),
    notes: NOTES[msisdn] ?? [],
    tags: TAGS[msisdn] ?? [],
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
    const tag = url.searchParams.get("tag") ?? "";
    const matchesQuery = (s: SubscriberItem) => !q || s.msisdn.includes(q) || (PROFILES[s.msisdn]?.name ?? "").toLowerCase().includes(q.toLowerCase());
    return HttpResponse.json(
      SUBSCRIBERS.filter((s) => matchesQuery(s) && (!status || s.status === status) && (!tag || (TAGS[s.msisdn] ?? []).includes(tag))).map((s) => ({
        ...s,
        ...(PROFILES[s.msisdn] ?? { name: null, email: null, city: null, segment: null }),
        tags: TAGS[s.msisdn] ?? [],
      })),
    );
  }),
  http.get("/api/customers/:msisdn/overview", ({ params }) => {
    const data = overviewFor(String(params.msisdn));
    return data ? HttpResponse.json(data) : HttpResponse.json({ detail: "Subscriber not found" }, { status: 404 });
  }),
  http.get("/api/tags", () => HttpResponse.json([...new Set(Object.values(TAGS).flat())].sort())),
  http.post("/api/customers/:msisdn/tags", async ({ params, request }) => {
    const msisdn = String(params.msisdn);
    const { tag } = (await request.json()) as { tag: string };
    const current = TAGS[msisdn] ?? [];
    TAGS[msisdn] = current.includes(tag) ? current : [...current, tag];
    return HttpResponse.json({ tags: TAGS[msisdn] });
  }),
  http.delete("/api/customers/:msisdn/tags/:tag", ({ params }) => {
    const msisdn = String(params.msisdn);
    TAGS[msisdn] = (TAGS[msisdn] ?? []).filter((t) => t !== decodeURIComponent(String(params.tag)));
    return HttpResponse.json({ tags: TAGS[msisdn] });
  }),
  http.post("/api/customers/:msisdn/notes", async ({ params, request }) => {
    const msisdn = String(params.msisdn);
    const { text } = (await request.json()) as { text: string };
    const note: NoteItem = { note_id: `N-${(NOTES[msisdn]?.length ?? 0) + 1}`, msisdn, author_name: "Priya", author_role: "agent", text, created_at: new Date().toISOString() };
    NOTES[msisdn] = [note, ...(NOTES[msisdn] ?? [])];
    return HttpResponse.json(note);
  }),
  http.get("/api/disputes", ({ request }) => {
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const msisdn = url.searchParams.get("msisdn");
    return HttpResponse.json(DISPUTES.filter((d) => (!status || d.status === status) && (!msisdn || d.msisdn === msisdn)));
  }),
  http.post("/api/disputes/:id/escalate", ({ params }) => {
    const dispute = DISPUTES.find((d) => d.dispute_id === params.id);
    if (!dispute) return HttpResponse.json({ detail: "Dispute not found" }, { status: 404 });
    dispute.status = "escalated";
    return HttpResponse.json({ dispute_id: dispute.dispute_id, status: "escalated", ticket_id: "TCK-abc123" });
  }),
  http.post("/api/disputes/:id/resolve", async ({ params, request }) => {
    const dispute = DISPUTES.find((d) => d.dispute_id === params.id);
    if (!dispute) return HttpResponse.json({ detail: "Dispute not found" }, { status: 404 });
    const { outcome } = (await request.json()) as { outcome: "resolved" | "rejected" };
    dispute.status = outcome;
    return HttpResponse.json({ dispute_id: dispute.dispute_id, status: outcome, reason: dispute.reason, amount_disputed: dispute.amount_disputed });
  }),
  http.get("/api/dashboard", () => HttpResponse.json(DASHBOARD)),
  http.get("/api/reports", ({ request }) => {
    const days = Number(new URL(request.url).searchParams.get("days") ?? "7") as 7 | 30 | 90;
    return HttpResponse.json(REPORTS[days] ?? REPORTS[7]);
  }),
  http.get("/api/audit", ({ request }) => {
    const url = new URL(request.url);
    const msisdn = url.searchParams.get("msisdn");
    const action = url.searchParams.get("action");
    return HttpResponse.json(AUDIT.filter((a) => (!msisdn || a.msisdn === msisdn) && (!action || a.action === action)));
  }),
  http.get("/api/audit/actions", () => HttpResponse.json([...new Set(AUDIT.map((a) => a.action))].sort())),
  http.post("/api/plans", async ({ request }) => {
    const body = (await request.json()) as PlanResponse;
    PLANS.push(body);
    return HttpResponse.json(body);
  }),
  http.put("/api/plans/:plan_id", async ({ params, request }) => {
    const body = (await request.json()) as Omit<PlanResponse, "plan_id">;
    const index = PLANS.findIndex((p) => p.plan_id === params.plan_id);
    if (index === -1) return HttpResponse.json({ detail: "Plan not found" }, { status: 404 });
    PLANS[index] = { plan_id: String(params.plan_id), ...body };
    return HttpResponse.json(PLANS[index]);
  }),
];

export const server = setupServer(...handlers);
