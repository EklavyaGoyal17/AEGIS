import { describe, it, expect, beforeEach } from 'vitest';
import { MockApiClient } from '@/lib/api/mock-client';

describe('MockApiClient', () => {
  let client: MockApiClient;

  beforeEach(() => {
    client = new MockApiClient();
  });

  it('fetches platform health with healthy status', async () => {
    const health = await client.getHealth();
    expect(health.status).toBe('healthy');
    expect(health.services?.policyEngine?.status).toBe('healthy');
  });

  it('retrieves policies and creates a new policy', async () => {
    const initialPolicies = await client.getPolicies();
    expect(initialPolicies.length).toBeGreaterThan(0);

    const newPolicy = await client.createPolicy({
      name: 'Test Policy',
      description: 'Test description',
      rules: [
        {
          action: 'read',
          resource: 'test/*',
          effect: 'ALLOW',
        },
      ],
      enabled: true,
    });

    expect(newPolicy.name).toBe('Test Policy');
    const updatedPolicies = await client.getPolicies();
    expect(updatedPolicies.some((p) => p.name === 'Test Policy')).toBe(true);
  });

  it('retrieves approvals and supports status filtering', async () => {
    const pending = await client.getApprovals({ status: 'PENDING' });
    expect(pending.data.every((a) => a.status === 'PENDING')).toBe(true);
  });

  it('resolves an approval and appends an audit event', async () => {
    const pendingList = await client.getApprovals({ status: 'PENDING' });
    const target = pendingList.data[0];
    expect(target).toBeDefined();
    if (!target) return;

    const resolveRes = await client.resolveApproval(target.approvalId, {
      action: 'APPROVE',
      reviewerId: 'test-reviewer@aegis.internal',
      reason: 'Authorized in unit test',
    });

    expect(resolveRes.status).toBe('APPROVED');
    expect(resolveRes.resolvedBy).toBe('test-reviewer@aegis.internal');

    // Verify status was persisted in memory
    const updatedList = await client.getApprovals({ status: 'APPROVED' });
    expect(updatedList.data.some((a) => a.approvalId === target.approvalId)).toBe(true);

    // Verify audit event was logged
    const auditEvents = await client.getAuditEvents({ eventType: 'APPROVAL_RESOLVED' });
    expect(auditEvents.data.some((e) => e.approvalId === target.approvalId)).toBe(true);
  });

  it('evaluates decision requests against active policies', async () => {
    // Read should be ALLOW
    const allowRes = await client.evaluateDecision({
      agentId: 'cs-support-agent',
      action: 'read',
      resource: 'customer-data/account/123',
    });
    expect(allowRes.effect).toBe('ALLOW');

    // Export PII should be DENY
    const denyRes = await client.evaluateDecision({
      agentId: 'data-export-agent',
      action: 'export',
      resource: 'customer-data/pii',
    });
    expect(denyRes.effect).toBe('DENY');

    // Modify should require approval
    const apprRes = await client.evaluateDecision({
      agentId: 'cs-support-agent',
      action: 'modify',
      resource: 'customer-data/account/123',
    });
    expect(apprRes.effect).toBe('REQUIRE_APPROVAL');
    expect(apprRes.approvalId).not.toBeNull();
  });
});
