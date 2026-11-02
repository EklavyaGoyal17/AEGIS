/**
 * AEGIS Mock Data — Deterministic, self-consistent dataset for demo mode
 *
 * Narrative: A customer-support AI agent reads customer data, then the
 * data-export agent attempts to export PII which is DENIED. A second
 * attempt triggers an approval workflow — the admin approves, the
 * export is re-evaluated and allowed. Meanwhile, an analytics agent
 * quietly crunches aggregated (non-PII) data without friction.
 *
 * Base timestamp: 2026-11-02T12:00:00Z
 */

import type {
  Approval,
  AuditEvent,
  Policy,
  DashboardMetrics,
  HealthResponse,
} from "@/lib/api/types";

// ─── Deterministic IDs ──────────────────────────────────────────
const ids = {
  // Decisions
  decision1: "d1a2b3c4-0001-4aaa-bbbb-000000000001",
  decision2: "d1a2b3c4-0002-4aaa-bbbb-000000000002",
  decision3: "d1a2b3c4-0003-4aaa-bbbb-000000000003",
  decision4: "d1a2b3c4-0004-4aaa-bbbb-000000000004",
  decision5: "d1a2b3c4-0005-4aaa-bbbb-000000000005",
  decision6: "d1a2b3c4-0006-4aaa-bbbb-000000000006",
  decision7: "d1a2b3c4-0007-4aaa-bbbb-000000000007",
  decision8: "d1a2b3c4-0008-4aaa-bbbb-000000000008",

  // Approvals
  approval1: "a1b2c3d4-0001-4eee-9999-000000000001",
  approval2: "a1b2c3d4-0002-4eee-9999-000000000002",
  approval3: "a1b2c3d4-0003-4eee-9999-000000000003",
  approval4: "a1b2c3d4-0004-4eee-9999-000000000004",
  approval5: "a1b2c3d4-0005-4eee-9999-000000000005",

  // Audit events
  event1: "e1e2e3e4-0001-4fff-aaaa-000000000001",
  event2: "e1e2e3e4-0002-4fff-aaaa-000000000002",
  event3: "e1e2e3e4-0003-4fff-aaaa-000000000003",
  event4: "e1e2e3e4-0004-4fff-aaaa-000000000004",
  event5: "e1e2e3e4-0005-4fff-aaaa-000000000005",
  event6: "e1e2e3e4-0006-4fff-aaaa-000000000006",
  event7: "e1e2e3e4-0007-4fff-aaaa-000000000007",
  event8: "e1e2e3e4-0008-4fff-aaaa-000000000008",
  event9: "e1e2e3e4-0009-4fff-aaaa-000000000009",
  event10: "e1e2e3e4-0010-4fff-aaaa-000000000010",

  // Policies
  policy1: "p1010101-0001-4ddd-8888-000000000001",
  policy2: "p1010101-0002-4ddd-8888-000000000002",
  policy3: "p1010101-0003-4ddd-8888-000000000003",

  // Correlation IDs (threads of related activity)
  corr1: "c0c0c0c0-0001-4ccc-7777-000000000001",
  corr2: "c0c0c0c0-0002-4ccc-7777-000000000002",
  corr3: "c0c0c0c0-0003-4ccc-7777-000000000003",
} as const;

// ─── Agent identities ───────────────────────────────────────────
export const agentIdentities = [
  {
    agentId: "cs-support-agent",
    name: "Customer Support Agent",
    description: "Handles tier-1 customer inquiries and case resolution",
  },
  {
    agentId: "data-export-agent",
    name: "Data Export Agent",
    description: "Exports customer data for compliance and analytics",
  },
  {
    agentId: "admin-agent",
    name: "Admin Agent",
    description: "Performs privileged administrative operations",
  },
  {
    agentId: "analytics-agent",
    name: "Analytics Agent",
    description: "Runs aggregate analytics on anonymised datasets",
  },
] as const;

// ─── Helper ─────────────────────────────────────────────────────
/** Offset minutes from the base timestamp */
function ts(minutesOffset: number): string {
  const base = new Date("2026-11-02T12:00:00Z");
  base.setMinutes(base.getMinutes() + minutesOffset);
  return base.toISOString();
}

const POLICY_VERSION = "1.3.0";

// ─── Policies ───────────────────────────────────────────────────
export const mockPolicies: Policy[] = [
  {
    policyId: ids.policy1,
    name: "Allow Customer Data Reads",
    description:
      "Permits support and analytics agents to read customer records for case resolution and aggregated reporting.",
    version: POLICY_VERSION,
    enabled: true,
    rules: [
      {
        action: "read",
        resource: "customer-data/*",
        effect: "ALLOW",
        conditions: [
          { field: "agentId", operator: "in", value: ["cs-support-agent", "analytics-agent"] },
        ],
        priority: 10,
      },
    ],
    createdAt: ts(-1440), // 1 day ago
    updatedAt: ts(-720),
    createdBy: "admin-agent",
    scope: "customer-data",
  },
  {
    policyId: ids.policy2,
    name: "Block PII Exports",
    description:
      "Denies bulk export of personally-identifiable customer data to prevent data exfiltration.",
    version: POLICY_VERSION,
    enabled: true,
    rules: [
      {
        action: "export",
        resource: "customer-data/pii",
        effect: "DENY",
        conditions: [],
        priority: 100,
      },
      {
        action: "export",
        resource: "customer-data/aggregated",
        effect: "ALLOW",
        conditions: [
          { field: "agentId", operator: "equals", value: "analytics-agent" },
        ],
        priority: 50,
      },
    ],
    createdAt: ts(-1440),
    updatedAt: ts(-720),
    createdBy: "admin-agent",
    scope: "customer-data",
  },
  {
    policyId: ids.policy3,
    name: "Require Approval for Modifications",
    description:
      "Any modification to customer records must be approved by a human operator before taking effect.",
    version: POLICY_VERSION,
    enabled: true,
    rules: [
      {
        action: "modify",
        resource: "customer-data/*",
        effect: "REQUIRE_APPROVAL",
        conditions: [],
        priority: 90,
      },
      {
        action: "delete",
        resource: "customer-data/*",
        effect: "REQUIRE_APPROVAL",
        conditions: [],
        priority: 95,
      },
    ],
    createdAt: ts(-1440),
    updatedAt: ts(-360),
    createdBy: "admin-agent",
    scope: "customer-data",
  },
];

// ─── Approvals ──────────────────────────────────────────────────
export const mockApprovals: Approval[] = [
  // 1 — PENDING: CS agent wants to modify a customer record
  {
    approvalId: ids.approval1,
    decisionId: ids.decision4,
    agentId: "cs-support-agent",
    action: "modify",
    resource: "customer-data/account/12345",
    status: "PENDING",
    reasonCodes: ["REQUIRE_APPROVAL:modification-policy"],
    policyVersion: POLICY_VERSION,
    requestedAt: ts(-15),
    expiresAt: ts(45),
    resolvedAt: null,
    resolvedBy: null,
    context: { field: "email", newValue: "customer-new@example.com" },
  },
  // 2 — PENDING: data-export agent wants to delete old records
  {
    approvalId: ids.approval2,
    decisionId: ids.decision5,
    agentId: "data-export-agent",
    action: "delete",
    resource: "customer-data/account/67890",
    status: "PENDING",
    reasonCodes: ["REQUIRE_APPROVAL:deletion-policy"],
    policyVersion: POLICY_VERSION,
    requestedAt: ts(-10),
    expiresAt: ts(50),
    resolvedAt: null,
    resolvedBy: null,
    context: { reason: "GDPR right-to-erasure request" },
  },
  // 3 — APPROVED: CS agent modified contact info (already resolved)
  {
    approvalId: ids.approval3,
    decisionId: ids.decision6,
    agentId: "cs-support-agent",
    action: "modify",
    resource: "customer-data/account/11111",
    status: "APPROVED",
    reasonCodes: ["REQUIRE_APPROVAL:modification-policy"],
    policyVersion: POLICY_VERSION,
    requestedAt: ts(-120),
    expiresAt: ts(-60),
    resolvedAt: ts(-90),
    resolvedBy: "operator@aegis.internal",
    context: { field: "phone", newValue: "+1-555-0199" },
  },
  // 4 — REJECTED: data-export agent tried to modify billing records
  {
    approvalId: ids.approval4,
    decisionId: ids.decision7,
    agentId: "data-export-agent",
    action: "modify",
    resource: "customer-data/billing/22222",
    status: "REJECTED",
    reasonCodes: ["REQUIRE_APPROVAL:modification-policy"],
    policyVersion: POLICY_VERSION,
    requestedAt: ts(-240),
    expiresAt: ts(-180),
    resolvedAt: ts(-200),
    resolvedBy: "operator@aegis.internal",
    context: { reason: "Billing changes are restricted to finance team" },
  },
  // 5 — EXPIRED: admin agent scheduled a bulk modify that no one reviewed
  {
    approvalId: ids.approval5,
    decisionId: ids.decision8,
    agentId: "admin-agent",
    action: "modify",
    resource: "customer-data/accounts/bulk-update",
    status: "EXPIRED",
    reasonCodes: ["REQUIRE_APPROVAL:modification-policy"],
    policyVersion: POLICY_VERSION,
    requestedAt: ts(-480),
    expiresAt: ts(-420),
    resolvedAt: null,
    resolvedBy: null,
    context: { batchSize: 1200 },
  },
];

// ─── Audit Events (story arc) ───────────────────────────────────
export const mockAuditEvents: AuditEvent[] = [
  // 1 — CS agent reads customer data → ALLOW
  {
    eventId: ids.event1,
    type: "DECISION_EVALUATED",
    timestamp: ts(-60),
    agentId: "cs-support-agent",
    action: "read",
    resource: "customer-data/account/12345",
    decisionId: ids.decision1,
    approvalId: null,
    effect: "ALLOW",
    correlationId: ids.corr1,
    policyVersion: POLICY_VERSION,
    metadata: { evaluationMs: 4 },
    actorId: null,
  },
  // 2 — CS agent action executed (read succeeds)
  {
    eventId: ids.event2,
    type: "AGENT_ACTION_EXECUTED",
    timestamp: ts(-59),
    agentId: "cs-support-agent",
    action: "read",
    resource: "customer-data/account/12345",
    decisionId: ids.decision1,
    approvalId: null,
    effect: "ALLOW",
    correlationId: ids.corr1,
    policyVersion: POLICY_VERSION,
    metadata: { rowsReturned: 1 },
    actorId: null,
  },
  // 3 — Data-export agent tries to export PII → DENY
  {
    eventId: ids.event3,
    type: "DECISION_EVALUATED",
    timestamp: ts(-45),
    agentId: "data-export-agent",
    action: "export",
    resource: "customer-data/pii",
    decisionId: ids.decision2,
    approvalId: null,
    effect: "DENY",
    correlationId: ids.corr2,
    policyVersion: POLICY_VERSION,
    metadata: { evaluationMs: 2, matchedPolicy: ids.policy2 },
    actorId: null,
  },
  // 4 — Export blocked
  {
    eventId: ids.event4,
    type: "AGENT_ACTION_BLOCKED",
    timestamp: ts(-45),
    agentId: "data-export-agent",
    action: "export",
    resource: "customer-data/pii",
    decisionId: ids.decision2,
    approvalId: null,
    effect: "DENY",
    correlationId: ids.corr2,
    policyVersion: POLICY_VERSION,
    metadata: { blockedReason: "PII export not permitted" },
    actorId: null,
  },
  // 5 — CS agent requests modify approval → REQUIRE_APPROVAL
  {
    eventId: ids.event5,
    type: "DECISION_EVALUATED",
    timestamp: ts(-15),
    agentId: "cs-support-agent",
    action: "modify",
    resource: "customer-data/account/12345",
    decisionId: ids.decision4,
    approvalId: ids.approval1,
    effect: "REQUIRE_APPROVAL",
    correlationId: ids.corr1,
    policyVersion: POLICY_VERSION,
    metadata: { evaluationMs: 3 },
    actorId: null,
  },
  // 6 — Approval requested event
  {
    eventId: ids.event6,
    type: "APPROVAL_REQUESTED",
    timestamp: ts(-15),
    agentId: "cs-support-agent",
    action: "modify",
    resource: "customer-data/account/12345",
    decisionId: ids.decision4,
    approvalId: ids.approval1,
    effect: "REQUIRE_APPROVAL",
    correlationId: ids.corr1,
    policyVersion: POLICY_VERSION,
    metadata: { ttlMinutes: 60 },
    actorId: null,
  },
  // 7 — Earlier approval was resolved (approval3 → APPROVED)
  {
    eventId: ids.event7,
    type: "APPROVAL_RESOLVED",
    timestamp: ts(-90),
    agentId: "cs-support-agent",
    action: "modify",
    resource: "customer-data/account/11111",
    decisionId: ids.decision6,
    approvalId: ids.approval3,
    effect: "ALLOW",
    correlationId: ids.corr1,
    policyVersion: POLICY_VERSION,
    metadata: { resolution: "APPROVED" },
    actorId: "operator@aegis.internal",
  },
  // 8 — Analytics agent runs aggregated export → ALLOW (no PII)
  {
    eventId: ids.event8,
    type: "DECISION_EVALUATED",
    timestamp: ts(-30),
    agentId: "analytics-agent",
    action: "export",
    resource: "customer-data/aggregated",
    decisionId: ids.decision3,
    approvalId: null,
    effect: "ALLOW",
    correlationId: ids.corr3,
    policyVersion: POLICY_VERSION,
    metadata: { evaluationMs: 2 },
    actorId: null,
  },
  // 9 — Analytics export executed
  {
    eventId: ids.event9,
    type: "AGENT_ACTION_EXECUTED",
    timestamp: ts(-29),
    agentId: "analytics-agent",
    action: "export",
    resource: "customer-data/aggregated",
    decisionId: ids.decision3,
    approvalId: null,
    effect: "ALLOW",
    correlationId: ids.corr3,
    policyVersion: POLICY_VERSION,
    metadata: { rowsExported: 50_000, format: "parquet" },
    actorId: null,
  },
  // 10 — Policy created event (the block-PII policy itself)
  {
    eventId: ids.event10,
    type: "POLICY_CREATED",
    timestamp: ts(-1440),
    agentId: null,
    action: null,
    resource: null,
    decisionId: null,
    approvalId: null,
    effect: null,
    correlationId: null,
    policyVersion: POLICY_VERSION,
    metadata: {
      policyId: ids.policy2,
      policyName: "Block PII Exports",
    },
    actorId: "admin-agent",
  },
];

// ─── Dashboard Metrics (computed from events) ───────────────────
export const mockDashboardMetrics: DashboardMetrics = {
  totalDecisions: 5,
  allowedCount: 3,
  deniedCount: 1,
  pendingApprovals: 2,

  recentEvents: mockAuditEvents.slice(0, 6),

  decisionsByHour: [
    { hour: "08:00", allowed: 12, denied: 1, pending: 0 },
    { hour: "09:00", allowed: 18, denied: 2, pending: 1 },
    { hour: "10:00", allowed: 24, denied: 3, pending: 0 },
    { hour: "11:00", allowed: 31, denied: 1, pending: 2 },
    { hour: "12:00", allowed: 3, denied: 1, pending: 2 },
  ],

  topAgents: [
    { agentId: "cs-support-agent", decisionCount: 42, deniedCount: 0 },
    { agentId: "analytics-agent", decisionCount: 35, deniedCount: 0 },
    { agentId: "data-export-agent", decisionCount: 18, deniedCount: 5 },
    { agentId: "admin-agent", decisionCount: 8, deniedCount: 0 },
  ],

  topDeniedActions: [
    { action: "export (PII)", count: 5 },
    { action: "delete", count: 2 },
    { action: "modify (bulk)", count: 1 },
  ],
};

// ─── Health ─────────────────────────────────────────────────────
export const mockHealthResponse: HealthResponse = {
  status: "healthy",
  version: "0.1.0-alpha",
  uptime: 86_400, // 24 hours in seconds
  services: {
    policyEngine: { status: "healthy", latency: 4 },
    approvalStore: { status: "healthy", latency: 8 },
    auditLog: { status: "healthy", latency: 6 },
    database: { status: "healthy", latency: 3 },
  },
};
