/**
 * AEGIS API Types — Canonical contract-aligned type definitions
 *
 * These types mirror the shared V1 API contract.
 * When Claude's official OpenAPI contract is available,
 * these should be regenerated from that schema.
 */
import { z } from "zod";

// ─── Decision Effect ─────────────────────────────────────────────
export const DecisionEffect = z.enum(["ALLOW", "DENY", "REQUIRE_APPROVAL"]);
export type DecisionEffect = z.infer<typeof DecisionEffect>;

// ─── Evaluation Request ──────────────────────────────────────────
export const EvaluationRequestSchema = z.object({
  agentId: z.string().min(1),
  action: z.string().min(1),
  resource: z.string().min(1),
  context: z.record(z.string(), z.unknown()).optional(),
  correlationId: z.guid().optional(),
});
export type EvaluationRequest = z.infer<typeof EvaluationRequestSchema>;

// ─── Decision Response ───────────────────────────────────────────
export const DecisionResponseSchema = z.object({
  decisionId: z.guid(),
  effect: DecisionEffect,
  reasonCodes: z.array(z.string()),
  policyVersion: z.string(),
  approvalId: z.guid().nullable(),
  expiresAt: z.string().datetime().nullable(),
});
export type DecisionResponse = z.infer<typeof DecisionResponseSchema>;

// ─── Approval ────────────────────────────────────────────────────
export const ApprovalStatus = z.enum([
  "PENDING",
  "APPROVED",
  "REJECTED",
  "EXPIRED",
  "CANCELLED",
  "CONSUMED",
]);
export type ApprovalStatus = z.infer<typeof ApprovalStatus>;

export const ApprovalSchema = z.object({
  approvalId: z.guid(),
  decisionId: z.guid(),
  agentId: z.string(),
  action: z.string(),
  resource: z.string(),
  status: ApprovalStatus,
  reasonCodes: z.array(z.string()),
  policyVersion: z.string(),
  requestedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable(),
  resolvedBy: z.string().nullable(),
  context: z.record(z.string(), z.unknown()).optional(),
  /** What the approver is shown and must echo back when resolving (v1 contract). */
  bindingDigest: z.string().optional(),
  argumentsDigest: z.string().nullable().optional(),
  requestingPrincipalId: z.string().optional(),
});
export type Approval = z.infer<typeof ApprovalSchema>;

export const ApprovalResolveRequestSchema = z.object({
  action: z.enum(["APPROVE", "REJECT"]),
  reason: z.string().optional(),
  /** Demo mode only. Against the real API the approver is always derived from the verified token. */
  reviewerId: z.string().min(1).optional(),
  /** Required by the real API: the bindingDigest of the approval the reviewer looked at. */
  expectedBindingDigest: z.string().optional(),
});
export type ApprovalResolveRequest = z.infer<typeof ApprovalResolveRequestSchema>;

export const ApprovalResolveResponseSchema = z.object({
  approvalId: z.guid(),
  status: ApprovalStatus,
  resolvedAt: z.string().datetime(),
  resolvedBy: z.string(),
});
export type ApprovalResolveResponse = z.infer<typeof ApprovalResolveResponseSchema>;

// ─── Audit Event ─────────────────────────────────────────────────
export const AuditEventTypeSchema = z.enum([
  "DECISION_EVALUATED",
  "APPROVAL_REQUESTED",
  "APPROVAL_RESOLVED",
  "APPROVAL_CONSUMED",
  "APPROVAL_EXPIRED",
  "EXECUTION_AUTHORIZED",
  "EXECUTION_REJECTED",
  "POLICY_CREATED",
  "POLICY_ACTIVATED",
  "POLICY_UPDATED",
  "AUTHENTICATION_FAILED",
  "AUTHORIZATION_ERROR",
  "AGENT_REGISTERED",
  "AGENT_ACTION_EXECUTED",
  "AGENT_ACTION_BLOCKED",
]);
export type AuditEventType = z.infer<typeof AuditEventTypeSchema>;

export const AuditEventSchema = z.object({
  eventId: z.guid(),
  type: AuditEventTypeSchema,
  timestamp: z.string().datetime(),
  agentId: z.string().nullable(),
  action: z.string().nullable(),
  resource: z.string().nullable(),
  decisionId: z.guid().nullable(),
  approvalId: z.guid().nullable(),
  effect: DecisionEffect.nullable().optional(),
  correlationId: z.guid().nullable(),
  policyVersion: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  actorId: z.string().nullable(),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;

// ─── Policy ──────────────────────────────────────────────────────
export const PolicyConditionSchema = z.object({
  field: z.string(),
  operator: z.enum(["equals", "not_equals", "contains", "in", "matches", "gt", "lt"]),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
});
export type PolicyCondition = z.infer<typeof PolicyConditionSchema>;

export const PolicyRuleSchema = z.object({
  action: z.string(),
  resource: z.string(),
  effect: DecisionEffect,
  conditions: z.array(PolicyConditionSchema).optional(),
  priority: z.number().int().optional(),
});
export type PolicyRule = z.infer<typeof PolicyRuleSchema>;

export const PolicySchema = z.object({
  policyId: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  version: z.string(),
  enabled: z.boolean(),
  rules: z.array(PolicyRuleSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  createdBy: z.string(),
  scope: z.string().optional(),
});
export type Policy = z.infer<typeof PolicySchema>;

export const CreatePolicyRequestSchema = z.object({
  name: z.string().min(1, "Policy name is required"),
  description: z.string().min(1, "Description is required"),
  rules: z.array(PolicyRuleSchema).min(1, "At least one rule is required"),
  enabled: z.boolean().default(true),
  scope: z.string().optional(),
});
export type CreatePolicyRequest = z.infer<typeof CreatePolicyRequestSchema>;

// ─── Health ──────────────────────────────────────────────────────
export const HealthResponseSchema = z.object({
  status: z.enum(["healthy", "degraded", "unhealthy"]),
  version: z.string(),
  uptime: z.number(),
  services: z.record(z.string(), z.object({
    status: z.enum(["healthy", "degraded", "unhealthy"]),
    latency: z.number().optional(),
  })).optional(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

// ─── Pagination ──────────────────────────────────────────────────
export const PaginatedResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    data: z.array(itemSchema),
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
    hasMore: z.boolean(),
  });

export type PaginatedResponse<T> = {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
};

// ─── API Error ───────────────────────────────────────────────────
export const ApiErrorSchema = z.object({
  error: z.string(),
  message: z.string(),
  statusCode: z.number(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

// ─── Dashboard Aggregates (proposed — demo mode only) ────────────
export interface DashboardMetrics {
  totalDecisions: number;
  allowedCount: number;
  deniedCount: number;
  pendingApprovals: number;
  recentEvents: AuditEvent[];
  decisionsByHour: Array<{
    hour: string;
    allowed: number;
    denied: number;
    pending: number;
  }>;
  topAgents: Array<{
    agentId: string;
    decisionCount: number;
    deniedCount: number;
  }>;
  topDeniedActions: Array<{
    action: string;
    count: number;
  }>;
}

// ─── Filter params ───────────────────────────────────────────────
export interface AuditFilters {
  startDate?: string;
  endDate?: string;
  agentId?: string;
  action?: string;
  effect?: DecisionEffect;
  correlationId?: string;
  eventType?: AuditEventType;
  page?: number;
  pageSize?: number;
}

export interface ApprovalFilters {
  status?: ApprovalStatus;
  agentId?: string;
  page?: number;
  pageSize?: number;
}

