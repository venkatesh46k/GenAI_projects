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

const limit = (fallback: number) => z.coerce.number().int().min(1).max(500).default(fallback);

export const CdrQuery = z.object({ limit: limit(10) });
export const TransactionsQuery = z.object({ limit: limit(20) });
export const SubscribersQuery = z.object({ limit: limit(100) });
export const DisputesQuery = z.object({ msisdn: z.string().min(1).optional(), limit: limit(50) });

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
