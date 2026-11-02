import fc from 'fast-check';
import { expect, test } from 'vitest';
import { canonicalJson } from '@aegis/contracts';
import {
  computeApprovalBindingDigest,
  computeArgumentsDigest,
} from '@aegis/contracts/crypto';
import {
  approvalBinding,
  argumentsDigest,
  canonical,
  type Principal,
} from '../src/domain.js';

// The backend keeps its own canonicalizer; the SDK, gateway and approvers use @aegis/contracts.
// Any byte difference would break approval binding and idempotency, so they must agree exactly.

test('backend canonical JSON is byte-identical to the contracts canonicalizer', () => {
  fc.assert(
    fc.property(fc.jsonValue({ maxDepth: 4 }), (value) => {
      expect(canonical(value)).toBe(canonicalJson(value));
    }),
    { numRuns: 2000 },
  );
});

test('backend arguments digest equals computeArgumentsDigest', () => {
  fc.assert(
    fc.property(fc.dictionary(fc.string(), fc.jsonValue({ maxDepth: 2 })), (args) => {
      expect(argumentsDigest(args)).toBe(computeArgumentsDigest(args));
    }),
    { numRuns: 1000 },
  );
});

test('backend approval binding equals computeApprovalBindingDigest', () => {
  const principal: Principal = {
    tenantId: '10000000-0000-4000-8000-000000000001',
    id: '10000000-0000-4000-8000-000000000002',
    issuer: 'https://identity.example',
    subject: 'machine',
    kind: 'machine',
    roles: [],
    connector: true,
  };
  const args = { text: 'hello' };
  const row = {
    agent_id: 'demo-agent',
    action: 'demo.note.create',
    resource_type: 'note',
    resource_id: 'n-1',
    arguments_digest: computeArgumentsDigest(args),
  };
  const expected = computeApprovalBindingDigest({
    tenantId: principal.tenantId,
    agentId: row.agent_id,
    principalId: principal.id,
    action: row.action,
    resource: { type: row.resource_type, id: row.resource_id },
    argumentsDigest: row.arguments_digest,
  });
  expect(approvalBinding(principal, row)).toBe(expected);
  expect(approvalBinding(principal, { ...row, arguments_digest: 'none' })).toBe(
    computeApprovalBindingDigest({
      tenantId: principal.tenantId,
      agentId: row.agent_id,
      principalId: principal.id,
      action: row.action,
      resource: { type: row.resource_type, id: row.resource_id },
      argumentsDigest: null,
    }),
  );
});
