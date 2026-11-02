import type { TSchema } from '@sinclair/typebox';
import { API_VERSION, ERROR_CODES } from '../api.js';
import { SCHEMAS } from '../registry.js';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

/**
 * Converts a TypeBox schema into a plain JSON Schema where every nested named schema becomes a `$ref`
 * produced by `refFor`. The root keeps its content but not its `$id`.
 */
export function toJsonSchema(schema: TSchema, refFor: (name: string) => string): JsonObject {
  return convert(schema, true, refFor) as JsonObject;
}

function convert(node: unknown, isRoot: boolean, refFor: (name: string) => string): Json {
  if (Array.isArray(node)) return node.map((n) => convert(n, false, refFor));
  if (node === null || typeof node !== 'object') return node as Json;
  const obj = node as Record<string, unknown>;
  const id = obj['$id'];
  if (!isRoot && typeof id === 'string' && id in SCHEMAS) return { $ref: refFor(id) };
  const out: JsonObject = {};
  // TypeBox emits draft-07 tuples (items: [...], additionalItems: false); 2020-12 uses prefixItems.
  if (Array.isArray(obj['items'])) {
    out['prefixItems'] = (obj['items'] as unknown[]).map((n) => convert(n, false, refFor));
    out['items'] = false;
  }
  for (const key of Object.keys(obj).sort()) {
    if (key === '$id') continue;
    if ((key === 'items' || key === 'additionalItems') && Array.isArray(obj['items'])) continue;
    const value = obj[key];
    if (key === '$ref' && typeof value === 'string' && value in SCHEMAS) {
      out[key] = refFor(value);
    } else if (key === 'default' || key === 'examples' || key === 'const') {
      out[key] = value as Json;
    } else if (key === 'properties' || key === 'patternProperties') {
      const props: JsonObject = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) props[k] = convert(v, false, refFor);
      out[key] = props;
    } else {
      out[key] = convert(value, false, refFor);
    }
  }
  return out;
}

export const JSON_SCHEMA_BUNDLE_ID = 'https://schemas.aegis.dev/v1/aegis-v1.schema.json';

/** All named schemas as one JSON Schema 2020-12 bundle addressable as `#/$defs/<Name>`. */
export function buildJsonSchemaBundle(): JsonObject {
  const defs: JsonObject = {};
  for (const name of Object.keys(SCHEMAS).sort()) {
    defs[name] = toJsonSchema(SCHEMAS[name]!, (n) => `#/$defs/${n}`);
  }
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: JSON_SCHEMA_BUNDLE_ID,
    title: `AEGIS API v${API_VERSION} schemas`,
    description: 'Generated from packages/contracts/src. Do not edit by hand; run `npm run generate`.',
    $defs: defs,
  };
}

export interface OpenApiExamples {
  readonly [name: string]: Json;
}

const ref = (name: string): JsonObject => ({ $ref: `#/components/schemas/${name}` });
const errorResponse = (description: string): JsonObject => ({
  description,
  headers: { 'X-Correlation-Id': { $ref: '#/components/headers/CorrelationId' } },
  content: { 'application/json': { schema: ref('ErrorEnvelope') } },
});
const stdErrors = (...extra: Array<[string, string]>): JsonObject => {
  const out: JsonObject = {
    '400': { $ref: '#/components/responses/InvalidRequest' },
    '401': { $ref: '#/components/responses/Unauthenticated' },
    '403': { $ref: '#/components/responses/Forbidden' },
    '429': { $ref: '#/components/responses/RateLimited' },
    '500': { $ref: '#/components/responses/Internal' },
    '503': { $ref: '#/components/responses/Unavailable' },
  };
  for (const [code, description] of extra) out[code] = errorResponse(description);
  return out;
};
const ok = (schema: string, description: string, examples: JsonObject = {}): JsonObject => ({
  description,
  headers: { 'X-Correlation-Id': { $ref: '#/components/headers/CorrelationId' } },
  content: { 'application/json': { schema: ref(schema), ...(Object.keys(examples).length ? { examples } : {}) } },
});
const ex = (examples: OpenApiExamples, ...names: string[]): JsonObject => {
  const out: JsonObject = {};
  for (const name of names) {
    const value = examples[name];
    if (value === undefined) throw new Error(`missing example ${name}`);
    out[name] = { value };
  }
  return out;
};
const queryParam = (name: string, schema: JsonObject, description: string): JsonObject => ({
  name,
  in: 'query',
  required: false,
  description,
  schema,
});

export function buildOpenApi(examples: OpenApiExamples): JsonObject {
  const schemas: JsonObject = {};
  for (const name of Object.keys(SCHEMAS).sort()) {
    schemas[name] = toJsonSchema(SCHEMAS[name]!, (n) => `#/components/schemas/${n}`);
  }
  const limit = { type: 'integer', minimum: 1, maximum: 200, default: 50 };
  const cursor = { type: 'string', minLength: 1, maxLength: 512 };

  return {
    openapi: '3.1.0',
    jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
    info: {
      title: 'AEGIS Authorization API',
      version: API_VERSION,
      description: [
        'AEGIS authorizes actions requested by autonomous AI agents independently of the model\'s own judgment.',
        '',
        'Trust model: tenant, principal and effective permissions are derived ONLY from the verified credential and',
        'server-managed grants. Request bodies never carry authoritative tenant identity, roles or permissions.',
        'A decision is not an execution credential. Protected tools must be invoked through a trusted enforcement',
        'point that verifies a single-use ExecutionAuthorization.',
        '',
        'Compatibility: v1 is frozen. Additive changes (new optional request fields, new response fields, new',
        'reason codes, new error codes) may appear in 1.x. Servers MUST reject unknown request fields; clients MUST',
        'ignore unknown response fields and treat unknown reason/error codes as opaque and non-retryable.',
        '',
        'Generated from packages/contracts/src — do not edit by hand.',
      ].join('\n'),
    },
    servers: [{ url: 'https://{host}', variables: { host: { default: 'aegis.example.invalid' } } }],
    security: [{ bearerAuth: [] }],
    tags: [
      { name: 'decisions' },
      { name: 'approvals' },
      { name: 'audit' },
      { name: 'policies' },
      { name: 'health' },
    ],
    paths: {
      '/v1/decisions/evaluate': {
        post: {
          tags: ['decisions'],
          operationId: 'evaluateDecision',
          summary: 'Evaluate whether an agent may perform an action on a resource.',
          description:
            'Idempotent by requestId. The authenticated credential MUST belong to body.agentId (else 403). ' +
            'Fails closed: any internal error produces 5xx or DENY, never ALLOW.',
          'x-aegis-required-scopes': ['aegis:decisions:evaluate'],
          'x-aegis-idempotency': 'requestId',
          parameters: [{ $ref: '#/components/parameters/CorrelationIdHeader' }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: ref('EvaluateDecisionRequest'),
                examples: ex(examples, 'evaluate-request'),
              },
            },
          },
          responses: {
            '200': ok(
              'EvaluateDecisionResponse',
              'Decision produced (ALLOW, DENY or REQUIRE_APPROVAL). DENY is a 200, not an error.',
              ex(examples, 'evaluate-response-allow', 'evaluate-response-deny', 'evaluate-response-require-approval'),
            ),
            ...stdErrors(['409', 'IDEMPOTENCY_CONFLICT: requestId reused with a different body.'], ['413', 'PAYLOAD_TOO_LARGE']),
          },
        },
      },
      '/v1/approvals': {
        get: {
          tags: ['approvals'],
          operationId: 'listApprovals',
          summary: 'List approval requests in the caller\'s tenant.',
          'x-aegis-required-scopes': ['aegis:approvals:read'],
          parameters: [
            queryParam('status', ref('ApprovalStatus'), 'Filter by status.'),
            queryParam('agentId', ref('AgentId'), 'Filter by agent.'),
            queryParam('limit', limit, 'Page size.'),
            queryParam('cursor', cursor, 'Opaque cursor from a previous page.'),
            { $ref: '#/components/parameters/CorrelationIdHeader' },
          ],
          responses: { '200': ok('ApprovalPage', 'A page of approvals.', ex(examples, 'approval-page')), ...stdErrors() },
        },
      },
      '/v1/approvals/{approvalId}/resolve': {
        post: {
          tags: ['approvals'],
          operationId: 'resolveApproval',
          summary: 'Approve or reject a pending approval.',
          description:
            'Only a principal with aegis:approvals:resolve in the same tenant, who is neither the requesting principal ' +
            'nor the agent, may resolve. Resolution is a compare-and-set on PENDING; expectedBindingDigest must match.',
          'x-aegis-required-scopes': ['aegis:approvals:resolve'],
          parameters: [
            { name: 'approvalId', in: 'path', required: true, schema: ref('Uuid') },
            { $ref: '#/components/parameters/IdempotencyKeyHeader' },
            { $ref: '#/components/parameters/CorrelationIdHeader' },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: ref('ResolveApprovalRequest'), examples: ex(examples, 'resolve-approval-request') },
            },
          },
          responses: {
            '200': ok('ApprovalRequest', 'Updated approval.', ex(examples, 'approval-request-approved')),
            '404': errorResponse('NOT_FOUND (also returned for approvals in other tenants).'),
            ...stdErrors([
              '409',
              'APPROVAL_NOT_PENDING, APPROVAL_BINDING_MISMATCH, SELF_APPROVAL_FORBIDDEN or IDEMPOTENCY_CONFLICT.',
            ]),
          },
        },
      },
      '/v1/audit/events': {
        get: {
          tags: ['audit'],
          operationId: 'listAuditEvents',
          summary: 'Read the tenant\'s hash-chained audit log in sequence order.',
          'x-aegis-required-scopes': ['aegis:audit:read'],
          parameters: [
            queryParam('from', ref('Timestamp'), 'Inclusive lower bound on occurredAt.'),
            queryParam('to', ref('Timestamp'), 'Exclusive upper bound on occurredAt.'),
            queryParam('type', ref('AuditEventType'), 'Filter by event type.'),
            queryParam('agentId', ref('AgentId'), 'Filter by agent.'),
            queryParam('decisionId', ref('Uuid'), 'Filter by decision.'),
            queryParam('limit', limit, 'Page size.'),
            queryParam('cursor', cursor, 'Opaque cursor from a previous page.'),
            { $ref: '#/components/parameters/CorrelationIdHeader' },
          ],
          responses: { '200': ok('AuditEventPage', 'A page of audit events.', ex(examples, 'audit-event-page')), ...stdErrors() },
        },
      },
      '/v1/policies': {
        get: {
          tags: ['policies'],
          operationId: 'listPolicies',
          summary: 'List policies in the caller\'s tenant.',
          'x-aegis-required-scopes': ['aegis:policies:read'],
          parameters: [
            queryParam('limit', limit, 'Page size.'),
            queryParam('cursor', cursor, 'Opaque cursor from a previous page.'),
            { $ref: '#/components/parameters/CorrelationIdHeader' },
          ],
          responses: { '200': ok('PolicyPage', 'A page of policies.', ex(examples, 'policy-page')), ...stdErrors() },
        },
        post: {
          tags: ['policies'],
          operationId: 'createPolicyVersion',
          summary: 'Create a policy or append a new immutable version.',
          description:
            'The tenant is taken from the authenticated administrator. The document is validated with the same ' +
            'validator the engine uses (@aegis/policy-engine compilePolicySet); invalid documents are rejected with ' +
            '400 POLICY_INVALID and are never stored as ACTIVE.',
          'x-aegis-required-scopes': ['aegis:policies:write'],
          parameters: [
            { $ref: '#/components/parameters/IdempotencyKeyHeader' },
            { $ref: '#/components/parameters/CorrelationIdHeader' },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: ref('CreatePolicyRequest'), examples: ex(examples, 'create-policy-request') },
            },
          },
          responses: {
            '201': ok('PolicyVersion', 'Version created.', ex(examples, 'policy-version')),
            ...stdErrors(['409', 'CONFLICT: expectedLatestVersion mismatch, or IDEMPOTENCY_CONFLICT.']),
          },
        },
      },
      '/v1/health': {
        get: {
          tags: ['health'],
          operationId: 'getHealth',
          summary: 'Liveness and readiness.',
          security: [],
          responses: {
            '200': ok('HealthResponse', 'Service is serving.', ex(examples, 'health-response')),
            '503': {
              description: 'Not ready. Clients MUST treat decisions as unavailable (fail closed).',
              content: { 'application/json': { schema: ref('HealthResponse') } },
            },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description:
            'Short-lived access token from the tenant IdP or AEGIS workload identity. The server derives tenantId, ' +
            'principal/agent identity and scopes exclusively from verified claims. Required scopes are listed in ' +
            'x-aegis-required-scopes per operation.',
        },
      },
      headers: {
        CorrelationId: {
          description: 'Echoes the request X-Correlation-Id or a server-generated value.',
          schema: { type: 'string', maxLength: 128 },
        },
      },
      parameters: {
        CorrelationIdHeader: {
          name: 'X-Correlation-Id',
          in: 'header',
          required: false,
          schema: { type: 'string', pattern: '^[A-Za-z0-9._:-]{1,128}$' },
        },
        IdempotencyKeyHeader: {
          name: 'Idempotency-Key',
          in: 'header',
          required: false,
          description: 'Makes retries of non-evaluate POSTs safe. Same key + different body => 409 IDEMPOTENCY_CONFLICT.',
          schema: ref('Uuid'),
        },
      },
      responses: {
        InvalidRequest: errorResponse('INVALID_REQUEST or POLICY_INVALID.'),
        Unauthenticated: errorResponse('UNAUTHENTICATED: missing, expired or invalid credential.'),
        Forbidden: errorResponse('FORBIDDEN: credential lacks scope, or agentId does not match the credential.'),
        RateLimited: {
          ...errorResponse('RATE_LIMITED. Honour Retry-After.'),
          headers: {
            'X-Correlation-Id': { $ref: '#/components/headers/CorrelationId' },
            'Retry-After': { schema: { type: 'integer', minimum: 0 } },
          },
        },
        Internal: errorResponse('INTERNAL. Not retryable by default; the decision is unknown and must be treated as DENY.'),
        Unavailable: errorResponse('UNAVAILABLE. Retryable with backoff; until success the action must not execute.'),
      },
      schemas: {
        ...schemas,
        ErrorCode: { type: 'string', enum: [...ERROR_CODES] },
      },
    },
  };
}
