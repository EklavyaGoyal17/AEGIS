import { Type, type Static } from '@sinclair/typebox';
import { RFC3339_UTC_PATTERN, UUID_PATTERN } from './formats.js';
import { LIMITS } from './limits.js';
import { REASON_CODE_PATTERN } from './reason-codes.js';

/*
 * Every schema that is exported as a named component carries `$id`. The OpenAPI/JSON Schema
 * generator replaces nested occurrences of a named schema with a `$ref`, so the `$id` values here
 * are the public component names and are part of the frozen contract.
 */

export const Uuid = Type.String({
  $id: 'Uuid',
  format: 'uuid',
  pattern: UUID_PATTERN,
  description: 'Canonical lowercase RFC 9562 UUID.',
  examples: ['0b5f1d2e-8a4c-4e7b-9f61-2d3c4b5a6978'],
});
export type Uuid = Static<typeof Uuid>;

export const Timestamp = Type.String({
  $id: 'Timestamp',
  format: 'date-time',
  pattern: RFC3339_UTC_PATTERN,
  description: 'RFC 3339 timestamp in UTC. Offsets other than "Z" are rejected.',
  examples: ['2026-11-02T18:30:00Z'],
});
export type Timestamp = Static<typeof Timestamp>;

export const IDENTIFIER_PATTERN = '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$';

/** Opaque, stable identifier. Never a display label; never used for authorization by its shape. */
export const Identifier = Type.String({
  $id: 'Identifier',
  pattern: IDENTIFIER_PATTERN,
  maxLength: LIMITS.identifierMaxLength,
  description:
    'Opaque stable identifier (letters, digits, ".", "_", ":", "-"; must start alphanumeric). ' +
    'Identifiers are compared byte-for-byte and are never interpreted.',
});
export type Identifier = Static<typeof Identifier>;

export const TenantId = Type.String({ ...Identifier, $id: 'TenantId', description: 'Tenant identifier. Never accepted from request bodies on authenticated routes; derived from the verified credential.' });
export const PrincipalId = Type.String({ ...Identifier, $id: 'PrincipalId', description: 'Human or service principal identifier.' });
export const AgentId = Type.String({ ...Identifier, $id: 'AgentId', description: 'Registered agent identity. A claim until matched against the authenticated credential.' });
export const PolicyId = Type.String({ ...Identifier, $id: 'PolicyId' });
export const GrantId = Type.String({ ...Identifier, $id: 'GrantId' });
export const CredentialRefId = Type.String({ ...Identifier, $id: 'CredentialRefId' });

export const ACTION_PATTERN = '^[a-z][a-z0-9_-]{0,62}(\\.[a-z][a-z0-9_-]{0,62}){1,4}$';

export const ActionName = Type.String({
  $id: 'ActionName',
  pattern: ACTION_PATTERN,
  maxLength: LIMITS.actionMaxLength,
  description:
    'Dotted action name "<resource>.<operation>" (2-5 lowercase segments), e.g. "crm.customers.export".',
  examples: ['crm.customers.export'],
});
export type ActionName = Static<typeof ActionName>;

/** "*", an exact action name, or a namespace prefix ending in ".*" (e.g. "crm.*"). */
export const ACTION_PATTERN_PATTERN =
  '^(\\*|[a-z][a-z0-9_-]{0,62}(\\.[a-z][a-z0-9_-]{0,62}){0,4}\\.\\*|[a-z][a-z0-9_-]{0,62}(\\.[a-z][a-z0-9_-]{0,62}){1,4})$';

export const ActionPattern = Type.String({
  $id: 'ActionPattern',
  pattern: ACTION_PATTERN_PATTERN,
  maxLength: LIMITS.actionMaxLength,
  description: 'Action matcher: "*", an exact action name, or a namespace prefix such as "crm.*". No other wildcards.',
});
export type ActionPattern = Static<typeof ActionPattern>;

export const RESOURCE_TYPE_PATTERN = '^[a-z][a-z0-9_-]{0,62}(\\.[a-z][a-z0-9_-]{0,62}){0,3}$';

export const ResourceType = Type.String({
  $id: 'ResourceType',
  pattern: RESOURCE_TYPE_PATTERN,
  maxLength: LIMITS.actionMaxLength,
  examples: ['crm.customer_table'],
});
export type ResourceType = Static<typeof ResourceType>;

export const ResourceTypePattern = Type.String({
  $id: 'ResourceTypePattern',
  pattern: '^(\\*|[a-z][a-z0-9_-]{0,62}(\\.[a-z][a-z0-9_-]{0,62}){0,3})$',
  maxLength: LIMITS.actionMaxLength,
  description: 'Exact resource type or "*".',
});
export type ResourceTypePattern = Static<typeof ResourceTypePattern>;

export const ResourceId = Type.String({
  $id: 'ResourceId',
  minLength: 1,
  maxLength: LIMITS.resourceIdMaxLength,
  pattern: '^[^\\u0000-\\u001f\\u007f]+$',
  description: 'Opaque resource identifier; control characters are rejected.',
});
export type ResourceId = Static<typeof ResourceId>;

export const ATTRIBUTE_KEY_PATTERN = '^[A-Za-z][A-Za-z0-9_]{0,63}$';

export const AttributeScalar = Type.Union(
  [
    Type.String({ maxLength: LIMITS.attributeStringMaxLength }),
    Type.Number(),
    Type.Boolean(),
    Type.Null(),
  ],
  { $id: 'AttributeScalar', description: 'String (<=1024 chars), finite number, boolean or null.' },
);
export type AttributeScalar = Static<typeof AttributeScalar>;

export const AttributeValue = Type.Union(
  [AttributeScalar, Type.Array(AttributeScalar, { maxItems: LIMITS.attributeArrayMaxItems })],
  { $id: 'AttributeValue', description: 'Scalar or flat list of scalars. Nested objects are not permitted.' },
);
export type AttributeValue = Static<typeof AttributeValue>;

export const Attributes = Type.Record(Type.String({ pattern: ATTRIBUTE_KEY_PATTERN }), AttributeValue, {
  $id: 'Attributes',
  additionalProperties: false,
  maxProperties: LIMITS.attributesMaxProperties,
  description:
    'Flat attribute map. Keys match ' + ATTRIBUTE_KEY_PATTERN + ' (so "__proto__" and dotted keys are impossible); ' +
    'at most 64 entries.',
});
export type Attributes = Static<typeof Attributes>;

export const Sensitivity = Type.Union(
  [Type.Literal('public'), Type.Literal('internal'), Type.Literal('confidential'), Type.Literal('restricted')],
  { $id: 'Sensitivity', description: 'Ordered data classification: public < internal < confidential < restricted.' },
);
export type Sensitivity = Static<typeof Sensitivity>;

export const SENSITIVITY_ORDER: Readonly<Record<Sensitivity, number>> = Object.freeze({
  public: 0,
  internal: 1,
  confidential: 2,
  restricted: 3,
});

export const Effect = Type.Union([Type.Literal('ALLOW'), Type.Literal('DENY'), Type.Literal('REQUIRE_APPROVAL')], {
  $id: 'Effect',
});
export type Effect = Static<typeof Effect>;

export const ReasonCode = Type.String({
  $id: 'ReasonCode',
  pattern: REASON_CODE_PATTERN,
  description: 'Machine-readable reason. Unknown codes must be treated as opaque by clients.',
});
export type ReasonCode = Static<typeof ReasonCode>;

export const DIGEST_PATTERN = '^sha256:[0-9a-f]{64}$';

export const Sha256Digest = Type.String({
  $id: 'Sha256Digest',
  pattern: DIGEST_PATTERN,
  description: '"sha256:" followed by lowercase hex SHA-256 of the AEGIS canonical JSON encoding (see canonicalization spec).',
});
export type Sha256Digest = Static<typeof Sha256Digest>;

export const ResourceRef = Type.Object(
  {
    type: ResourceType,
    id: ResourceId,
    attributes: Attributes,
  },
  {
    $id: 'ResourceRef',
    additionalProperties: false,
    description:
      'Target resource. Caller-supplied attributes are claims: the server MUST overwrite server-owned keys ' +
      '(see docs/security/integration-requirements.md) before evaluation.',
  },
);
export type ResourceRef = Static<typeof ResourceRef>;

export const ResourceKey = Type.Object(
  { type: ResourceType, id: ResourceId },
  { $id: 'ResourceKey', additionalProperties: false },
);
export type ResourceKey = Static<typeof ResourceKey>;
