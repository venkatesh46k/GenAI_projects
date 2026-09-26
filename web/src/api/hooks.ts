import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CustomerOverview, PlanResponse, RechargeResponse, SessionUser, SubscriberItem } from "@contract/schemas";
import { api, ApiError } from "@/lib/api";

export const keys = {
  session: ["session"] as const,
  customers: (q: string, status: string) => ["customers", { q, status }] as const,
  overview: (msisdn: string) => ["overview", msisdn] as const,
  plans: ["plans"] as const,
  health: ["assistant-health"] as const,
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

export function useCustomers(q: string, status: string) {
  return useQuery({
    queryKey: keys.customers(q, status),
    queryFn: () => {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (status) params.set("status", status);
      return api<SubscriberItem[]>(`/api/customers?${params}`);
    },
    placeholderData: keepPreviousData, // keep showing the last list while a new search loads: no flicker per keystroke
  });
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
    onSuccess: () => void client.invalidateQueries({ queryKey: keys.overview(msisdn) }),
  });
}
