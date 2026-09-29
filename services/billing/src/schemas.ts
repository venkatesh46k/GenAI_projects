import { z } from "zod";

// ---- request validation (422 on failure, with FastAPI-shaped `detail`, so existing clients keep working) ----

export const RechargeBody = z.object({
  msisdn: z.string(),
  amount: z.number(),
  plan_id: z.string().nullable().optional(),
});

export const DisputeBody = z.object({
  msisdn: z.string(),
  reason: z.string().min(1),
  amount_disputed: z.number().min(0),
});

// ---- public (browser-facing) API ----

export const ROLES = ["agent", "team_lead"] as const;
export type Role = (typeof ROLES)[number];

export const LoginBody = z.strictObject({
  name: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[\p{L}][\p{L} .'-]*$/u, "Use letters, spaces, dots, apostrophes and hyphens"),
  role: z.enum(ROLES),
});

export const CustomerRechargeBody = z.strictObject({
  amount: z.number(),
  plan_id: z.string().nullable().optional(),
});

export const CustomersQuery = z.object({
  q: z.string().max(40).optional(), // a phone number or a customer's name
  status: z.enum(["active", "barred", "expired"]).optional(),
  tag: z.string().max(24).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

const limit = (fallback: number) => z.coerce.number().int().min(1).max(500).default(fallback);

export const CdrQuery = z.object({ limit: limit(10) });
export const TransactionsQuery = z.object({ limit: limit(20) });
export const SubscribersQuery = z.object({ limit: limit(100) });
export const DISPUTE_STATUSES = ["open", "escalated", "resolved", "rejected"] as const;
export const DisputesQuery = z.object({
  msisdn: z.string().min(1).optional(),
  status: z.enum(DISPUTE_STATUSES).optional(),
  limit: limit(50),
});

export const TAG_PATTERN = /^[\p{L}\p{N} .'-]{1,24}$/u;
export const AddTagBody = z.strictObject({ tag: z.string().trim().regex(TAG_PATTERN, "Use up to 24 letters, digits, spaces, dots, apostrophes and hyphens") });

export const AddNoteBody = z.strictObject({ text: z.string().trim().min(1).max(2000) });

export const RESOLUTION_OUTCOMES = ["resolved", "rejected"] as const;
export const ResolveDisputeBody = z.strictObject({ outcome: z.enum(RESOLUTION_OUTCOMES) });

export const PlanBody = z.strictObject({
  plan_id: z
    .string()
    .trim()
    .min(2)
    .max(20)
    .regex(/^[A-Z0-9_]+$/, "Use uppercase letters, digits and underscores, e.g. PLAN_249"),
  name: z.string().trim().min(2).max(40),
  price: z.number().positive().max(100_000),
  validity_days: z.number().int().positive().max(3650),
  data_per_day_gb: z.number().min(0).max(1000),
  voice_minutes: z.number().int().min(0).max(1_000_000),
  sms_per_day: z.number().int().min(0).max(10_000),
});
export const UpdatePlanBody = PlanBody.omit({ plan_id: true });

export const ReportsQuery = z.object({ days: z.coerce.number().int().refine((v) => [7, 30, 90].includes(v), "days must be 7, 30 or 90").default(7) });
export const AuditQuery = z.object({ msisdn: z.string().min(1).optional(), action: z.string().min(1).optional(), limit: limit(100) });

// ---- response shapes (the API contract; mirrors mock_api/models.py) ----

export interface BalanceResponse {
  msisdn: string;
  balance: number;
  plan_id: string | null;
  status: string;
}

export interface PlanResponse {
  plan_id: string;
  name: string;
  price: number;
  validity_days: number;
  data_per_day_gb: number;
  voice_minutes: number;
  sms_per_day: number;
}

export interface RechargeResponse {
  txn_id: string;
  new_balance: number;
  status: "success";
}

export interface CdrItem {
  cdr_id: string;
  call_type: string;
  duration_sec: number | null;
  data_mb: number | null;
  charge: number;
  timestamp: string;
}

export interface DisputeResponse {
  dispute_id: string;
  status: string;
}

export interface DisputeDetail {
  dispute_id: string;
  status: string;
  reason: string;
  amount_disputed: number;
}

export interface EscalateResponse {
  dispute_id: string;
  status: "escalated";
  ticket_id: string;
}

export interface SubscriberItem {
  msisdn: string;
  plan_id: string | null;
  balance: number;
  status: string;
  last_recharge_date: string | null;
}

export interface TransactionItem {
  txn_id: string;
  type: string;
  amount: number;
  balance_after: number;
  timestamp: string;
}

export interface DisputeSummary extends DisputeDetail {
  msisdn: string;
  created_at: string;
}

export interface NoteItem {
  note_id: string;
  msisdn: string;
  author_name: string;
  author_role: Role;
  text: string;
  created_at: string;
}

/** Contact/account details beyond the phone number. Every field is nullable: profiles are filled in over time, not
 * required up front (the demo data has one for every generated customer, but not for the 3 original fixtures). */
export interface CustomerProfile {
  name: string | null;
  email: string | null;
  city: string | null;
  segment: string | null;
}

/** A customer row for the list screen: SubscriberItem plus its tags and profile. */
export interface CustomerListItem extends SubscriberItem, CustomerProfile {
  tags: string[];
}

export interface CustomerOverview {
  subscriber: SubscriberItem;
  profile: CustomerProfile | null;
  plan: PlanResponse | null;
  usage: CdrItem[];
  transactions: TransactionItem[];
  disputes: DisputeSummary[];
  notes: NoteItem[];
  tags: string[];
}

export interface AuditEntry {
  id: string;
  at: string;
  actor_name: string;
  actor_role: Role;
  action: string;
  msisdn: string | null;
  detail: string | null;
}

export interface ReportStats {
  plan_distribution: Array<{ plan_id: string; name: string; customers: number }>;
  revenue_trend: Array<{ date: string; amount: number }>;
  usage_by_type: Array<{ call_type: string; count: number; total_charge: number }>;
  days: number;
}

export interface DashboardStats {
  customer_count: number;
  barred_count: number;
  total_balance: number;
  today_recharge_count: number;
  today_recharge_amount: number;
  open_disputes: number;
  escalated_disputes: number;
  /** Oldest first, the 7 most recent calendar days including today. */
  revenue_last_7_days: Array<{ date: string; amount: number }>;
}

export interface SessionUser {
  name: string;
  role: Role;
}
