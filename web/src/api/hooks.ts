import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AiHealth } from "@contract/chat";
import type {
  AuditEntry,
  CustomerListItem,
  CustomerOverview,
  DashboardStats,
  DisputeDetail,
  DisputeSummary,
  NoteItem,
  PlanResponse,
  RechargeResponse,
  ReportStats,
  SessionUser,
} from "@contract/schemas";
import { api, ApiError } from "@/lib/api";

export interface AssistantHealth {
  status: string;
  assistant: AiHealth | null;
}

export const keys = {
  session: ["session"] as const,
  customers: (q: string, status: string, tag: string) => ["customers", { q, status, tag }] as const,
  overview: (msisdn: string) => ["overview", msisdn] as const,
  plans: ["plans"] as const,
  health: ["assistant-health"] as const,
  tags: ["tags"] as const,
  disputes: (status: string, msisdn?: string) => ["disputes", { status, msisdn }] as const,
  dashboard: ["dashboard"] as const,
  reports: (days: number) => ["reports", days] as const,
  audit: (msisdn: string, action: string) => ["audit", { msisdn, action }] as const,
  auditActions: ["audit-actions"] as const,
};

/** The signed-in user, or null when signed out. A 401 here is an answer, not an error. */
export function useSession() {
  return useQuery({
    queryKey: keys.session,
    queryFn: async (): Promise<SessionUser | null> => {
      try {
        return await api<SessionUser>("/api/session");
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    staleTime: Infinity,
    retry: false,
  });
}

export function useLogin() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; role: SessionUser["role"] }) => api<SessionUser>("/api/session", { method: "POST", json: body }),
    onSuccess: (user) => client.setQueryData(keys.session, user),
  });
}

export function useLogout() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>("/api/session", { method: "DELETE" }),
    onSuccess: () => {
      client.setQueryData(keys.session, null);
      client.removeQueries({ predicate: (query) => query.queryKey[0] !== "session" }); // nothing from this user stays cached
    },
  });
}

export function useCustomers(q: string, status: string, tag = "") {
  return useQuery({
    queryKey: keys.customers(q, status, tag),
    queryFn: () => {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (status) params.set("status", status);
      if (tag) params.set("tag", tag);
      return api<CustomerListItem[]>(`/api/customers?${params}`);
    },
    placeholderData: keepPreviousData, // keep showing the last list while a new search loads: no flicker per keystroke
  });
}

/** Every tag any customer carries, for the list screen's filter menu. */
export function useAllTags() {
  return useQuery({ queryKey: keys.tags, queryFn: () => api<string[]>("/api/tags"), staleTime: 30_000 });
}

export function useOverview(msisdn: string) {
  return useQuery({
    queryKey: keys.overview(msisdn),
    queryFn: () => api<CustomerOverview>(`/api/customers/${encodeURIComponent(msisdn)}/overview`),
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
  });
}

export function usePlans() {
  return useQuery({ queryKey: keys.plans, queryFn: () => api<PlanResponse[]>("/api/plans"), staleTime: 5 * 60_000 });
}

export function useCreatePlan() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: PlanResponse) => api<PlanResponse>("/api/plans", { method: "POST", json: body }),
    onSuccess: () => void client.invalidateQueries({ queryKey: keys.plans }),
  });
}

export function useUpdatePlan() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ plan_id, ...body }: PlanResponse) => api<PlanResponse>(`/api/plans/${encodeURIComponent(plan_id)}`, { method: "PUT", json: body }),
    onSuccess: () => void client.invalidateQueries({ queryKey: keys.plans }),
  });
}

export function useRecharge(msisdn: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { amount: number; plan_id: string | null }) =>
      api<RechargeResponse>(`/api/customers/${encodeURIComponent(msisdn)}/recharge`, { method: "POST", json: body }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.overview(msisdn) });
      void client.invalidateQueries({ queryKey: ["customers"] });
    },
  });
}

export function useEscalate(msisdn: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (disputeId: string) =>
      api<{ dispute_id: string; status: string; ticket_id: string }>(`/api/disputes/${encodeURIComponent(disputeId)}/escalate`, { method: "POST" }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.overview(msisdn) });
      void client.invalidateQueries({ queryKey: ["disputes"] });
      void client.invalidateQueries({ queryKey: keys.dashboard });
    },
  });
}

/** Add or remove a tag on one customer. Invalidates the overview, the customer list and the all-tags menu. */
export function useTags(msisdn: string) {
  const client = useQueryClient();
  const invalidate = () => {
    void client.invalidateQueries({ queryKey: keys.overview(msisdn) });
    void client.invalidateQueries({ queryKey: ["customers"] });
    void client.invalidateQueries({ queryKey: keys.tags });
  };
  const add = useMutation({
    mutationFn: (tag: string) => api<{ tags: string[] }>(`/api/customers/${encodeURIComponent(msisdn)}/tags`, { method: "POST", json: { tag } }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (tag: string) => api<{ tags: string[] }>(`/api/customers/${encodeURIComponent(msisdn)}/tags/${encodeURIComponent(tag)}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
  return { add, remove };
}

export function useAddNote(msisdn: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (text: string) => api<NoteItem>(`/api/customers/${encodeURIComponent(msisdn)}/notes`, { method: "POST", json: { text } }),
    onSuccess: () => void client.invalidateQueries({ queryKey: keys.overview(msisdn) }),
  });
}

/** The dispute workspace: every dispute, optionally narrowed to one status and/or one customer. */
export function useDisputes(status: string, msisdn?: string) {
  return useQuery({
    queryKey: keys.disputes(status, msisdn),
    queryFn: () => {
      const params = new URLSearchParams({ limit: "200" });
      if (status) params.set("status", status);
      if (msisdn) params.set("msisdn", msisdn);
      return api<DisputeSummary[]>(`/api/disputes?${params}`);
    },
    placeholderData: keepPreviousData,
  });
}

export function useResolveDispute() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ disputeId, outcome }: { disputeId: string; outcome: "resolved" | "rejected" }) =>
      api<DisputeDetail>(`/api/disputes/${encodeURIComponent(disputeId)}/resolve`, { method: "POST", json: { outcome } }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["disputes"] });
      void client.invalidateQueries({ queryKey: ["overview"] }); // the dispute could belong to any customer overview cached
      void client.invalidateQueries({ queryKey: keys.dashboard });
    },
  });
}

export function useDashboard() {
  return useQuery({ queryKey: keys.dashboard, queryFn: () => api<DashboardStats>("/api/dashboard"), staleTime: 15_000, refetchInterval: 60_000 });
}

export function useReports(days: 7 | 30 | 90) {
  return useQuery({ queryKey: keys.reports(days), queryFn: () => api<ReportStats>(`/api/reports?days=${days}`), placeholderData: keepPreviousData });
}

export function useAudit(msisdn = "", action = "") {
  return useQuery({
    queryKey: keys.audit(msisdn, action),
    queryFn: () => {
      const params = new URLSearchParams();
      if (msisdn) params.set("msisdn", msisdn);
      if (action) params.set("action", action);
      return api<AuditEntry[]>(`/api/audit?${params}`);
    },
    placeholderData: keepPreviousData,
  });
}

export function useAuditActions() {
  return useQuery({ queryKey: keys.auditActions, queryFn: () => api<string[]>("/api/audit/actions"), staleTime: 30_000 });
}

/** The assistant's status: which provider/model is active, and whether it has finished loading. `poll` keeps
 * checking every 5s while it is still warming up (the Copilot drawer wants this); the Settings page does not.
 * `enabled` skips fetching entirely (the Copilot drawer only needs this while it is open). */
export function useHealth(poll = false, enabled = true) {
  return useQuery({
    queryKey: keys.health,
    queryFn: () => api<AssistantHealth>("/api/health"),
    enabled,
    refetchInterval: poll ? (query) => (query.state.data?.assistant?.ready === false ? 5000 : false) : false,
    staleTime: poll ? 0 : 15_000,
  });
}
