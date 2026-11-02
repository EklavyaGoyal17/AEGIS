/**
 * AEGIS React Query hooks — typed data fetching for all API endpoints
 */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  ApprovalFilters,
  AuditFilters,
  ApprovalResolveRequest,
  CreatePolicyRequest,
  EvaluationRequest,
} from "@/lib/api/types";
import { getApiClient } from "@/lib/api";

// Query keys
export const queryKeys = {
  health: ["health"] as const,
  approvals: (filters?: ApprovalFilters) => ["approvals", filters] as const,
  auditEvents: (filters?: AuditFilters) => ["audit-events", filters] as const,
  policies: ["policies"] as const,
  dashboard: ["dashboard"] as const,
} as const;

/** Fetch platform health */
export function useHealth() {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: () => getApiClient().getHealth(),
    refetchInterval: 30_000,
    retry: 2,
  });
}

/** Fetch approvals with optional filters */
export function useApprovals(filters?: ApprovalFilters) {
  return useQuery({
    queryKey: queryKeys.approvals(filters),
    queryFn: () => getApiClient().getApprovals(filters),
    refetchInterval: 10_000,
  });
}

/** Resolve an approval (approve/reject) */
export function useResolveApproval() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      approvalId,
      request,
    }: {
      approvalId: string;
      request: ApprovalResolveRequest;
    }) => getApiClient().resolveApproval(approvalId, request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["approvals"] });
      void queryClient.invalidateQueries({ queryKey: ["audit-events"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

/** Fetch audit events with filters */
export function useAuditEvents(filters?: AuditFilters) {
  return useQuery({
    queryKey: queryKeys.auditEvents(filters),
    queryFn: () => getApiClient().getAuditEvents(filters),
  });
}

/** Fetch policies */
export function usePolicies() {
  return useQuery({
    queryKey: queryKeys.policies,
    queryFn: () => getApiClient().getPolicies(),
  });
}

/** Create a new policy */
export function useCreatePolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (req: CreatePolicyRequest) => getApiClient().createPolicy(req),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.policies });
    },
  });
}

/** Evaluate a decision */
export function useEvaluateDecision() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (req: EvaluationRequest) => getApiClient().evaluateDecision(req),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["audit-events"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

/** Dashboard aggregate metrics */
export function useDashboardMetrics() {
  return useQuery({
    queryKey: queryKeys.dashboard,
    queryFn: async () => {
      const client = getApiClient();
      // Aggregate from available endpoints
      const [approvals, events] = await Promise.all([
        client.getApprovals({ pageSize: 100 }),
        client.getAuditEvents({ pageSize: 100 }),
      ]);
      return { approvals, events };
    },
    refetchInterval: 15_000,
  });
}

