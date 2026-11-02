import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { buildJsonSchemaBundle, buildOpenApi } from '../src/index.js';
import { loadExamples } from './helpers.js';

type Obj = any;
const committed = parse(readFileSync(new URL('../openapi/aegis-v1.yaml', import.meta.url), 'utf8')) as Obj;
const generated = buildOpenApi(loadExamples() as never) as Obj;

const FROZEN_ROUTES: Array<[string, string]> = [
  ['post', '/v1/decisions/evaluate'],
  ['post', '/v1/approvals/{approvalId}/resolve'],
  ['get', '/v1/approvals'],
  ['get', '/v1/audit/events'],
  ['get', '/v1/policies'],
  ['post', '/v1/policies'],
  ['get', '/v1/health'],
];

function* walk(node: unknown, path = ''): Generator<[string, Obj]> {
  if (node && typeof node === 'object') {
    yield [path, node as Obj];
    for (const [k, v] of Object.entries(node)) yield* walk(v, `${path}/${k}`);
  }
}

describe('OpenAPI v1 document', () => {
  it('committed YAML matches the generator output (no drift)', () => {
    expect(committed).toEqual(generated);
  });

  it('committed JSON Schema bundle matches the generator output', () => {
    const bundle = JSON.parse(readFileSync(new URL('../schemas/aegis-v1.schema.json', import.meta.url), 'utf8'));
    expect(bundle).toEqual(buildJsonSchemaBundle());
  });

  it('declares OpenAPI 3.1 and API version 1.x', () => {
    expect(committed.openapi).toBe('3.1.0');
    expect(committed.info.version).toMatch(/^1\.\d+\.\d+$/);
  });

  it('defines exactly the frozen routes', () => {
    const actual: Array<[string, string]> = [];
    for (const [path, item] of Object.entries(committed.paths as Obj)) {
      for (const method of Object.keys(item as Obj)) actual.push([method, path]);
    }
    expect(actual.sort()).toEqual([...FROZEN_ROUTES].sort());
  });

  it('every operation except health requires bearer auth and declares scopes', () => {
    for (const [method, path] of FROZEN_ROUTES) {
      const op = committed.paths[path][method];
      if (path === '/v1/health') {
        expect(op.security).toEqual([]);
        continue;
      }
      expect(op.security, `${method} ${path}`).toBeUndefined(); // inherits global bearerAuth
      expect(op['x-aegis-required-scopes']?.length, `${method} ${path}`).toBeGreaterThan(0);
      expect(Object.keys(op.responses)).toEqual(expect.arrayContaining(['401', '403', '500', '503']));
    }
    expect(committed.security).toEqual([{ bearerAuth: [] }]);
  });

  it('operationIds are unique', () => {
    const ids = FROZEN_ROUTES.map(([m, p]) => committed.paths[p][m].operationId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every $ref resolves', () => {
    const unresolved: string[] = [];
    for (const [path, node] of walk(committed)) {
      if (typeof node.$ref !== 'string') continue;
      const target = (node.$ref as string)
        .replace(/^#\//, '')
        .split('/')
        .reduce<any>((acc, seg) => (acc == null ? acc : acc[seg]), committed);
      if (target === undefined) unresolved.push(`${path} -> ${node.$ref}`);
    }
    expect(unresolved).toEqual([]);
  });

  it('request bodies that carry authority-sensitive data forbid unknown properties', () => {
    for (const name of ['EvaluateDecisionRequest', 'ResolveApprovalRequest', 'CreatePolicyRequest', 'PolicyDocument', 'PolicyRule']) {
      expect(committed.components.schemas[name].additionalProperties, name).toBe(false);
    }
  });

  it('the evaluate request carries no tenant, principal, role or permission fields', () => {
    const props = Object.keys(committed.components.schemas.EvaluateDecisionRequest.properties);
    for (const forbidden of ['tenantId', 'principalId', 'role', 'roles', 'permissions', 'scopes', 'isAdmin']) {
      expect(props).not.toContain(forbidden);
    }
    expect(committed.components.schemas.EvaluateDecisionRequest.required.sort()).toEqual(
      ['action', 'agentId', 'context', 'requestId', 'resource'].sort(),
    );
  });

  it('the evaluate response has the frozen required fields', () => {
    expect(committed.components.schemas.EvaluateDecisionResponse.required.sort()).toEqual(
      ['approvalId', 'decisionId', 'effect', 'expiresAt', 'policyVersion', 'reasonCodes'].sort(),
    );
  });

  it('every non-2xx response uses the error envelope', () => {
    for (const [method, path] of FROZEN_ROUTES) {
      const responses = committed.paths[path][method].responses as Obj;
      for (const [status, response] of Object.entries<Obj>(responses)) {
        if (status.startsWith('2') || path === '/v1/health') continue;
        const resolved = response.$ref
          ? committed.components.responses[(response.$ref as string).split('/').pop()!]
          : response;
        expect(resolved.content['application/json'].schema.$ref, `${method} ${path} ${status}`).toBe(
          '#/components/schemas/ErrorEnvelope',
        );
      }
    }
  });
});
