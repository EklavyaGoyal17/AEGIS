/**
 * AEGIS Mock API Client — In-memory implementation for demo / offline mode
 *
 * Returns deterministic mock data with realistic latencies (200-500ms).
 * Supports filtering, pagination, and stateful approval resolution.
 */

import type {
  EvaluationRequest,
  DecisionResponse,
  Approval,
  ApprovalFilters,
  ApprovalResolveRequest,
  ApprovalResolveResponse,
  AuditEvent,
  AuditFilters,
  Policy,
  CreatePolicyRequest,
  HealthResponse,
  PaginatedResponse,
  DashboardMetrics,
} from "@/lib/api/types";
import {
  mockApprovals,
  mockAuditEvents,
  mockPolicies,
  mockDashboardMetrics,
  mockHealthResponse,
} from "@/lib/api/mock-data";

// ─── Helpers ────────────────────────────────────────────────────

/** Simulate network latency between min and max ms (inclusive). */
function delay(minMs: number = 200, maxMs: number = 500): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Generate a deterministic-looking UUID v4 for new resources. */
function generateUuid(): string {
  const hex = () => Math.floor(Math.random() * 16).toString(16);
  const seg = (len: number) => Array.from({ length: len }, hex).join("");
  return `${seg(8)}-${seg(4)}-4${seg(3)}-${["8", "9", "a", "b"][Math.floor(Math.random() * 4)]}${seg(3)}-${seg(12)}`;
}

/** Paginate an array and return a PaginatedResponse. */
function paginate<T>(
  items: T[],
  page: number = 1,
  pageSize: number = 20,
): PaginatedResponse<T> {
  const start = (page - 1) * pageSize;
  const data = items.slice(start, start + pageSize);

  return {
    data,
    total: items.length,
    page,
    pageSize,
    hasMore: start + pageSize < items.length,
  };
}

// ─── Mock Client ────────────────────────────────────────────────

export class MockApiClient {
  /** In-memory mutable state so mutations persist within a session. */
  private approvals: Approval[];
  private auditEvents: AuditEvent[];
  private policies: Policy[];

  constructor() {
    // Deep-clone so each MockApiClient instance is independent
    this.approvals = structuredClone(mockApprovals);
    this.auditEvents = structuredClone(mockAuditEvents);
    this.policies = structuredClone(mockPolicies);
  }

  // ── Decisions ────────────────────────────────────────────────

  async evaluateDecision(req: EvaluationRequest): Promise<DecisionResponse> {
    await delay();

    // Simple evaluation: check mock policies in priority order
    let effect: DecisionResponse["effect"] = "ALLOW";
    let approvalId: string | null = null;

    for (const policy of this.policies) {
      if (!policy.enabled) continue;

      for (const rule of policy.rules) {
        const actionMatch =
          rule.action === req.action || rule.action === "*";
        const resourceMatch =
          rule.resource === req.resource ||
          (rule.resource.endsWith("/*") &&
            req.resource.startsWith(rule.resource.replace("/*", "")));

        if (actionMatch && resourceMatch) {
          effect = rule.effect;

          if (effect === "REQUIRE_APPROVAL") {
            approvalId = generateUuid();
          }

          break;
        }
      }
    }

    return {
      decisionId: generateUuid(),
      effect,
      reasonCodes: effect === "DENY" ? ["DENY:policy-match"] : [],
      policyVersion: this.policies[0]?.version ?? "1.0.0",
      approvalId,
      expiresAt:
        effect === "REQUIRE_APPROVAL"
          ? new Date(Date.now() + 3_600_000).toISOString()
          : null,
    };
  }

  // ── Approvals ────────────────────────────────────────────────

  async getApprovals(
    filters?: ApprovalFilters,
  ): Promise<PaginatedResponse<Approval>> {
    await delay();

    let filtered = [...this.approvals];

    if (filters?.status) {
      filtered = filtered.filter((a) => a.status === filters.status);
    }
    if (filters?.agentId) {
      filtered = filtered.filter((a) => a.agentId === filters.agentId);
    }

    // Sort newest first
    filtered.sort(
      (a, b) =>
        new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime(),
    );

    return paginate(filtered, filters?.page, filters?.pageSize);
  }

  async resolveApproval(
    approvalId: string,
    req: ApprovalResolveRequest,
  ): Promise<ApprovalResolveResponse> {
    await delay(300, 600);

    const approval = this.approvals.find((a) => a.approvalId === approvalId);

    if (!approval) {
      throw new Error(`Approval ${approvalId} not found`);
    }
    if (approval.status !== "PENDING") {
      throw new Error(
        `Approval ${approvalId} is already ${approval.status}`,
      );
    }

    const resolvedAt = new Date().toISOString();
    const newStatus = req.action === "APPROVE" ? "APPROVED" : "REJECTED";

    // Mutate in-place so future reads reflect the change
    approval.status = newStatus;
    approval.resolvedAt = resolvedAt;
    approval.resolvedBy = req.reviewerId;

    // Append an audit event for the resolution
    this.auditEvents.unshift({
      eventId: generateUuid(),
      type: "APPROVAL_RESOLVED",
      timestamp: resolvedAt,
      agentId: approval.agentId,
      action: approval.action,
      resource: approval.resource,
      decisionId: approval.decisionId,
      approvalId: approval.approvalId,
      effect: newStatus === "APPROVED" ? "ALLOW" : "DENY",
      correlationId: null,
      policyVersion: approval.policyVersion,
      metadata: { resolution: newStatus, reason: req.reason ?? null },
      actorId: req.reviewerId,
    });

    return {
      approvalId: approval.approvalId,
      status: newStatus,
      resolvedAt,
      resolvedBy: req.reviewerId,
    };
  }

  // ── Audit Events ─────────────────────────────────────────────

  async getAuditEvents(
    filters?: AuditFilters,
  ): Promise<PaginatedResponse<AuditEvent>> {
    await delay();

    let filtered = [...this.auditEvents];

    if (filters?.agentId) {
      filtered = filtered.filter((e) => e.agentId === filters.agentId);
    }
    if (filters?.effect) {
      filtered = filtered.filter((e) => e.effect === filters.effect);
    }
    if (filters?.correlationId) {
      filtered = filtered.filter(
        (e) => e.correlationId === filters.correlationId,
      );
    }
    if (filters?.eventType) {
      filtered = filtered.filter((e) => e.type === filters.eventType);
    }
    if (filters?.action) {
      filtered = filtered.filter((e) => e.action === filters.action);
    }
    if (filters?.startDate) {
      const start = new Date(filters.startDate).getTime();
      filtered = filtered.filter(
        (e) => new Date(e.timestamp).getTime() >= start,
      );
    }
    if (filters?.endDate) {
      const end = new Date(filters.endDate).getTime();
      filtered = filtered.filter(
        (e) => new Date(e.timestamp).getTime() <= end,
      );
    }

    // Sort newest first
    filtered.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );

    return paginate(filtered, filters?.page, filters?.pageSize);
  }

  // ── Policies ─────────────────────────────────────────────────

  async getPolicies(): Promise<Policy[]> {
    await delay();
    return structuredClone(this.policies);
  }

  async createPolicy(req: CreatePolicyRequest): Promise<Policy> {
    await delay(300, 600);

    const now = new Date().toISOString();
    const newPolicy: Policy = {
      policyId: generateUuid(),
      name: req.name,
      description: req.description,
      version: "1.0.0",
      enabled: req.enabled ?? true,
      rules: req.rules,
      createdAt: now,
      updatedAt: now,
      createdBy: "console-user",
      scope: req.scope,
    };

    this.policies.push(newPolicy);

    // Append audit event
    this.auditEvents.unshift({
      eventId: generateUuid(),
      type: "POLICY_CREATED",
      timestamp: now,
      agentId: null,
      action: null,
      resource: null,
      decisionId: null,
      approvalId: null,
      effect: null,
      correlationId: null,
      policyVersion: newPolicy.version,
      metadata: {
        policyId: newPolicy.policyId,
        policyName: newPolicy.name,
      },
      actorId: "console-user",
    });

    return structuredClone(newPolicy);
  }

  // ── Health ───────────────────────────────────────────────────

  async getHealth(): Promise<HealthResponse> {
    await delay(100, 200);
    return structuredClone(mockHealthResponse);
  }

  // ── Dashboard (demo-only convenience) ────────────────────────

  async getDashboardMetrics(): Promise<DashboardMetrics> {
    await delay();

    // Recompute pending count from live state
    const pendingApprovals = this.approvals.filter(
      (a) => a.status === "PENDING",
    ).length;

    return {
      ...structuredClone(mockDashboardMetrics),
      pendingApprovals,
      recentEvents: structuredClone(this.auditEvents.slice(0, 6)),
    };
  }
}

/** Singleton mock client instance */
export const mockApi = new MockApiClient();
