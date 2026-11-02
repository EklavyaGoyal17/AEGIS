/**
 * AEGIS v1 wire contract (packages/contracts/openapi/aegis-v1.yaml) and mappers to the console's
 * view models. The real API client validates every response against these schemas; anything that
 * does not match the frozen contract is rejected rather than rendered.
 */
import { z } from "zod";
import type {
  Approval,
  AuditEvent,
  AuditEventType,
  CreatePolicyRequest,
  DecisionResponse,
  HealthResponse,
  PaginatedResponse,
  Policy,
  PolicyCondition,
} from "./types";
import { AuditEventTypeSchema } from "./types";

const Effect = z.enum(["ALLOW", "DENY", "REQUIRE_APPROVAL"]);
const Timestamp = z.string().datetime();
const ResourceKey = z.object({ type: z.string(), id: z.string() });
const Attributes = z.record(z.string(), z.unknown());

export const WireDecision = z.object({
  decisionId: z.guid(),
  effect: Effect,
  reasonCodes: z.array(z.string()),
  policyVersion: z.string(),
  approvalId: z.guid().nullable(),
  expiresAt: Timestamp,
});

export const WireApproval = z.object({
  approvalId: z.guid(),
  tenantId: z.string(),
  decisionId: z.guid(),
  requestId: z.guid(),
  agentId: z.string(),
  requestingPrincipalId: z.string(),
  action: z.string(),
  resource: ResourceKey.extend({ attributes: Attributes }),
  argumentsDigest: z.string().nullable(),
  bindingDigest: z.string(),
  policyVersion: z.string(),
  matchedRuleIds: z.array(z.string()),
  reasonCodes: z.array(z.string()),
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "EXPIRED", "CANCELLED", "CONSUMED"]),
  createdAt: Timestamp,
  expiresAt: Timestamp,
  resolution: z
    .object({
      decision: z.enum(["APPROVE", "REJECT"]),
      resolvedBy: z.string(),
      resolvedAt: Timestamp,
      comment: z.string().nullable(),
      bindingDigest: z.string(),
    })
    .nullable(),
});

export const WireAuditEvent = z.object({
  eventId: z.guid(),
  tenantId: z.string(),
  sequence: z.number().int(),
  occurredAt: Timestamp,
  type: z.string(),
  actor: z.object({ kind: z.enum(["PRINCIPAL", "AGENT", "SYSTEM"]), id: z.string() }),
  requestId: z.guid().nullable(),
  decisionId: z.guid().nullable(),
  approvalId: z.guid().nullable(),
  policyVersion: z.string().nullable(),
  action: z.string().nullable(),
  resource: ResourceKey.nullable(),
  effect: Effect.nullable(),
  reasonCodes: z.array(z.string()),
  payloadDigest: z.string(),
  previousEventHash: z.string().nullable(),
  eventHash: z.string(),
});

export const WirePolicy = z.object({
  policyId: z.string(),
  tenantId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  activeVersion: z.number().int().nullable(),
  latestVersion: z.number().int(),
  tenantPolicyVersion: z.string(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});

export const WirePolicyVersion = z.object({
  policyId: z.string(),
  tenantId: z.string(),
  version: z.number().int(),
  state: z.enum(["DRAFT", "ACTIVE", "SUPERSEDED"]),
  documentDigest: z.string(),
  document: z.object({ rules: z.array(z.record(z.string(), z.unknown())) }).passthrough(),
  createdBy: z.string(),
  createdAt: Timestamp,
});

export const WireHealth = z.object({
  status: z.enum(["ok", "degraded", "unavailable"]),
  apiVersion: z.string(),
  time: Timestamp,
});

export const WireErrorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    correlationId: z.string(),
    retryable: z.boolean(),
  }),
});

export const wirePage = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });

type Page<T> = { items: T[]; nextCursor: string | null };

export function toPage<W, V>(page: Page<W>, map: (w: W) => V): PaginatedResponse<V> {
  const data = page.items.map(map);
  // The API is cursor-paginated and does not report totals; "total" is what this page contains.
  return { data, total: data.length, page: 1, pageSize: data.length, hasMore: page.nextCursor !== null };
}

const resourceLabel = (r: { type: string; id: string }) => `${r.type}/${r.id}`;

export function toApproval(w: z.infer<typeof WireApproval>): Approval {
  return {
    approvalId: w.approvalId,
    decisionId: w.decisionId,
    agentId: w.agentId,
    action: w.action,
    resource: resourceLabel(w.resource),
    status: w.status,
    reasonCodes: w.reasonCodes,
    policyVersion: w.policyVersion,
    requestedAt: w.createdAt,
    expiresAt: w.expiresAt,
    resolvedAt: w.resolution?.resolvedAt ?? null,
    resolvedBy: w.resolution?.resolvedBy ?? null,
    context: { ...w.resource.attributes, matchedRules: w.matchedRuleIds.join(", ") },
    bindingDigest: w.bindingDigest,
    argumentsDigest: w.argumentsDigest,
    requestingPrincipalId: w.requestingPrincipalId,
  };
}

export function toAuditEvent(w: z.infer<typeof WireAuditEvent>): AuditEvent {
  const known = AuditEventTypeSchema.safeParse(w.type);
  return {
    eventId: w.eventId,
    type: (known.success ? known.data : "AUTHORIZATION_ERROR") as AuditEventType,
    timestamp: w.occurredAt,
    agentId: w.actor.kind === "AGENT" ? w.actor.id : null,
    action: w.action,
    resource: w.resource ? resourceLabel(w.resource) : null,
    decisionId: w.decisionId,
    approvalId: w.approvalId,
    effect: w.effect,
    correlationId: w.requestId,
    policyVersion: w.policyVersion,
    actorId: w.actor.id,
    metadata: {
      sequence: w.sequence,
      reasonCodes: w.reasonCodes,
      eventHash: w.eventHash,
      previousEventHash: w.previousEventHash,
      payloadDigest: w.payloadDigest,
      ...(known.success ? {} : { originalType: w.type }),
    },
  };
}

export function toPolicy(w: z.infer<typeof WirePolicy>): Policy {
  return {
    policyId: w.policyId,
    name: w.name,
    description: w.description ?? "",
    version: `${w.activeVersion ?? w.latestVersion} (${w.tenantPolicyVersion})`,
    enabled: w.activeVersion !== null,
    // GET /v1/policies returns summaries; rule bodies are not part of the list contract.
    rules: [],
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
    createdBy: "",
  };
}

export function toHealth(w: z.infer<typeof WireHealth>): HealthResponse {
  const status = w.status === "ok" ? "healthy" : w.status === "degraded" ? "degraded" : "unhealthy";
  return { status, version: w.apiVersion, uptime: 0 };
}

export function toDecision(w: z.infer<typeof WireDecision>): DecisionResponse {
  return { ...w };
}

const ATTRIBUTE_REF =
  /^(action|resource\.type|resource\.id|agent\.id|principal\.id|(resource\.attributes|agent\.attributes|principal\.attributes|request\.context|env)\.[A-Za-z][A-Za-z0-9_]{0,63})$/;

export class PolicyTranslationError extends Error {
  override readonly name = "PolicyTranslationError";
}

function toCondition(c: PolicyCondition): Record<string, unknown> {
  if (!ATTRIBUTE_REF.test(c.field)) {
    throw new PolicyTranslationError(
      `Condition field "${c.field}" is not a valid attribute reference (e.g. resource.attributes.recordCount, env.networkZone).`,
    );
  }
  const ref = { ref: c.field };
  switch (c.operator) {
    case "equals":
      return { eq: [ref, { value: c.value }] };
    case "not_equals":
      return { ne: [ref, { value: c.value }] };
    case "gt":
      return { gt: [ref, { value: c.value }] };
    case "lt":
      return { lt: [ref, { value: c.value }] };
    case "in":
      return { in: [ref, { values: Array.isArray(c.value) ? c.value : [c.value] }] };
    default:
      // The AEGIS DSL intentionally has no substring or regular-expression operators.
      throw new PolicyTranslationError(`Operator "${c.operator}" is not supported by the AEGIS policy language.`);
  }
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100) || "policy";

/** Translates the console's rule editor model into a v1 CreatePolicyRequest (aegis.policy/v1 DSL). */
export function toCreatePolicyRequest(req: CreatePolicyRequest): Record<string, unknown> {
  const rules = req.rules.map((r, i) => {
    const conditions = (r.conditions ?? []).map(toCondition);
    return {
      id: `rule-${i + 1}`,
      effect: r.effect,
      actions: [r.action],
      resourceTypes: [r.resource],
      ...(conditions.length === 1 ? { when: conditions[0] } : conditions.length > 1 ? { when: { all: conditions } } : {}),
      ...(r.effect === "REQUIRE_APPROVAL" ? { approval: { ttlSeconds: 3600 } } : {}),
    };
  });
  return {
    policyId: slug(req.name),
    name: req.name,
    description: req.description,
    document: { schemaVersion: "aegis.policy/v1", rules },
    activate: req.enabled ?? true,
    expectedLatestVersion: null,
  };
}
