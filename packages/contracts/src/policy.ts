import { Type, type Static, type TSchema } from '@sinclair/typebox';
import { LIMITS } from './limits.js';
import {
  ActionName,
  ActionPattern,
  AttributeScalar,
  Effect,
  PolicyId,
  PrincipalId,
  ResourceTypePattern,
  Sensitivity,
  Sha256Digest,
  TenantId,
  Timestamp,
} from './primitives.js';

/*
 * AEGIS Policy DSL v1 — a JSON AST. There is no expression parser and nothing is ever evaluated as
 * code. The grammar is deliberately small: boolean combinators, comparisons against attribute
 * references and literals, existence, and string prefix/suffix checks. No regular expressions.
 */

export const POLICY_SCHEMA_VERSION = 'aegis.policy/v1';

/**
 * Attribute reference grammar. Roots and their trust level:
 *   action, resource.type, resource.id         — validated request fields
 *   resource.attributes.<k>                    — server-resolved resource attributes (server owns sensitive keys)
 *   agent.id, agent.attributes.<k>             — server registry (trusted)
 *   principal.id, principal.attributes.<k>     — server registry (trusted)
 *   env.<k>                                    — server-derived environment, e.g. network zone, MFA (trusted)
 *   request.context.<k>                        — CALLER-SUPPLIED, UNTRUSTED (may be model generated)
 */
export const ATTRIBUTE_REF_PATTERN =
  '^(action|resource\\.type|resource\\.id|agent\\.id|principal\\.id|' +
  '(resource\\.attributes|agent\\.attributes|principal\\.attributes|request\\.context|env)\\.[A-Za-z][A-Za-z0-9_]{0,63})$';

export const AttributeRef = Type.String({
  $id: 'AttributeRef',
  pattern: ATTRIBUTE_REF_PATTERN,
  description: 'Reference to an evaluation attribute. "request.context.*" is caller-supplied and untrusted.',
  examples: ['resource.attributes.recordCount', 'env.networkZone'],
});
export type AttributeRef = Static<typeof AttributeRef>;

export const Operand = Type.Union(
  [
    Type.Object({ ref: AttributeRef }, { additionalProperties: false }),
    Type.Object({ value: AttributeScalar }, { additionalProperties: false }),
    Type.Object(
      { values: Type.Array(AttributeScalar, { minItems: 1, maxItems: LIMITS.policyLiteralListMax }) },
      { additionalProperties: false },
    ),
  ],
  { $id: 'Operand' },
);
export type Operand = Static<typeof Operand>;

const pair = (name: string) =>
  Type.Object({ [name]: Type.Tuple([Operand, Operand]) }, { additionalProperties: false });

const stringTest = (name: string) =>
  Type.Object(
    { [name]: Type.Tuple([Type.Object({ ref: AttributeRef }, { additionalProperties: false }), Type.String({ minLength: 1, maxLength: LIMITS.attributeStringMaxLength })]) },
    { additionalProperties: false },
  );

export const Condition = Type.Recursive(
  (This) =>
    Type.Union([
      Type.Object({ all: Type.Array(This, { minItems: 1, maxItems: 32 }) }, { additionalProperties: false }),
      Type.Object({ any: Type.Array(This, { minItems: 1, maxItems: 32 }) }, { additionalProperties: false }),
      Type.Object({ not: This }, { additionalProperties: false }),
      pair('eq'),
      pair('ne'),
      pair('lt'),
      pair('lte'),
      pair('gt'),
      pair('gte'),
      pair('in'),
      Type.Object({ exists: AttributeRef }, { additionalProperties: false }),
      stringTest('startsWith'),
      stringTest('endsWith'),
    ]),
  {
    $id: 'Condition',
    description:
      'Boolean condition AST evaluated with three-valued (Kleene) logic. Missing or mistyped attributes yield UNKNOWN.',
  },
);
// The recursive Static type is widened by TypeBox; the policy engine re-validates structurally.
export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { eq: [Operand, Operand] }
  | { ne: [Operand, Operand] }
  | { lt: [Operand, Operand] }
  | { lte: [Operand, Operand] }
  | { gt: [Operand, Operand] }
  | { gte: [Operand, Operand] }
  | { in: [Operand, Operand] }
  | { exists: AttributeRef }
  | { startsWith: [{ ref: AttributeRef }, string] }
  | { endsWith: [{ ref: AttributeRef }, string] };

export const Weekday = Type.Union(
  ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map((d) => Type.Literal(d)),
  { $id: 'Weekday' },
) as TSchema;
export type Weekday = 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN';

export const TimeWindow = Type.Object(
  {
    days: Type.Array(Weekday, { minItems: 1, maxItems: 7, uniqueItems: true }),
    start: Type.String({ pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$', description: 'Inclusive local start "HH:MM".' }),
    end: Type.String({ pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$|^24:00$', description: 'Exclusive local end "HH:MM" (or "24:00"); must be after start.' }),
    utcOffset: Type.String({
      pattern: '^[+-](0[0-9]|1[0-4]):[0-5][0-9]$',
      description: 'Fixed UTC offset. IANA zones are intentionally unsupported in v1 for deterministic evaluation.',
    }),
  },
  { $id: 'TimeWindow', additionalProperties: false },
);
export type TimeWindow = { days: Weekday[]; start: string; end: string; utcOffset: string };

export const SensitivityRange = Type.Object(
  { min: Type.Optional(Sensitivity), max: Type.Optional(Sensitivity) },
  {
    $id: 'SensitivityRange',
    additionalProperties: false,
    description: 'Matches resource.attributes.sensitivity. A missing or unrecognised value is treated as "restricted".',
  },
);
export type SensitivityRange = Static<typeof SensitivityRange>;

export const ApprovalRequirement = Type.Object(
  {
    ttlSeconds: Type.Integer({ minimum: LIMITS.approvalTtlSecondsMin, maximum: LIMITS.approvalTtlSecondsMax }),
  },
  { $id: 'ApprovalRequirement', additionalProperties: false },
);
export type ApprovalRequirement = Static<typeof ApprovalRequirement>;

export const RULE_ID_PATTERN = '^[a-z][a-z0-9-]{0,63}$';

export const PolicyRule = Type.Object(
  {
    id: Type.String({ pattern: RULE_ID_PATTERN }),
    description: Type.Optional(Type.String({ maxLength: LIMITS.descriptionMaxLength })),
    effect: Effect,
    actions: Type.Array(ActionPattern, { minItems: 1, maxItems: LIMITS.policyRulePatternsMax }),
    resourceTypes: Type.Array(ResourceTypePattern, { minItems: 1, maxItems: LIMITS.policyRulePatternsMax }),
    sensitivity: Type.Optional(SensitivityRange),
    timeWindows: Type.Optional(Type.Array(TimeWindow, { minItems: 1, maxItems: LIMITS.policyTimeWindowsMax })),
    when: Type.Optional(Condition),
    approval: Type.Optional(ApprovalRequirement),
  },
  {
    $id: 'PolicyRule',
    additionalProperties: false,
    description:
      'A rule applies when action, resource type, sensitivity, time window and condition all match. ' +
      'Precedence is by effect only: DENY > REQUIRE_APPROVAL > ALLOW. There are no numeric priorities.',
  },
);
export type PolicyRule = Omit<Static<typeof PolicyRule>, 'when' | 'timeWindows'> & {
  when?: Condition;
  timeWindows?: TimeWindow[];
};

export const PolicyDocument = Type.Object(
  {
    schemaVersion: Type.Literal(POLICY_SCHEMA_VERSION),
    actionCatalog: Type.Optional(
      Type.Array(ActionName, { minItems: 1, maxItems: LIMITS.policyActionCatalogMax, uniqueItems: true }),
    ),
    decisionTtlSeconds: Type.Optional(Type.Integer({ minimum: 1, maximum: LIMITS.decisionTtlSecondsMax })),
    rules: Type.Array(PolicyRule, { minItems: 1, maxItems: LIMITS.policyRulesMax }),
  },
  {
    $id: 'PolicyDocument',
    additionalProperties: false,
    description:
      'Tenant policy document. It intentionally has no tenantId: the tenant is bound by the server from the ' +
      'authenticated administrator, never from the document.',
  },
);
export type PolicyDocument = Omit<Static<typeof PolicyDocument>, 'rules'> & { rules: PolicyRule[] };

export const PolicyVersionState = Type.Union(
  [Type.Literal('DRAFT'), Type.Literal('ACTIVE'), Type.Literal('SUPERSEDED')],
  { $id: 'PolicyVersionState' },
);
export type PolicyVersionState = Static<typeof PolicyVersionState>;

export const PolicyVersion = Type.Object(
  {
    policyId: PolicyId,
    tenantId: TenantId,
    version: Type.Integer({ minimum: 1, description: 'Monotonic per policy.' }),
    state: PolicyVersionState,
    documentDigest: Sha256Digest,
    document: PolicyDocument,
    createdBy: PrincipalId,
    createdAt: Timestamp,
  },
  { $id: 'PolicyVersion' },
);
export type PolicyVersion = Omit<Static<typeof PolicyVersion>, 'document'> & { document: PolicyDocument };

export const Policy = Type.Object(
  {
    policyId: PolicyId,
    tenantId: TenantId,
    name: Type.String({ minLength: 1, maxLength: 200 }),
    description: Type.Union([Type.String({ maxLength: LIMITS.descriptionMaxLength }), Type.Null()]),
    activeVersion: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    latestVersion: Type.Integer({ minimum: 1 }),
    tenantPolicyVersion: Type.String({
      minLength: 1,
      maxLength: 128,
      description: 'The tenant-wide policy set version string that decisions report as policyVersion.',
    }),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  },
  { $id: 'Policy' },
);
export type Policy = Static<typeof Policy>;

export const CreatePolicyRequest = Type.Object(
  {
    policyId: PolicyId,
    name: Type.String({ minLength: 1, maxLength: 200 }),
    description: Type.Optional(Type.String({ maxLength: LIMITS.descriptionMaxLength })),
    document: PolicyDocument,
    activate: Type.Boolean({ description: 'Activate the new version atomically on creation.' }),
    expectedLatestVersion: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()], {
      description:
        'Optimistic concurrency guard. null = the policy must not exist yet; N = the latest version must be N. ' +
        'Mismatch returns 409 CONFLICT.',
    }),
  },
  {
    $id: 'CreatePolicyRequest',
    additionalProperties: false,
    description: 'Creates a policy or appends a new immutable version. Requires scope aegis:policies:write.',
  },
);
export type CreatePolicyRequest = Omit<Static<typeof CreatePolicyRequest>, 'document'> & { document: PolicyDocument };
