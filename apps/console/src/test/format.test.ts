import { describe, it, expect } from 'vitest';
import {
  formatRelativeTime,
  formatAbsoluteTime,
  effectLabel,
  approvalStatusLabel,
  shortId,
  redactValue,
  effectToVariant,
  statusToVariant,
} from '@/lib/utils/format';

describe('Format Utilities', () => {
  it('correctly maps decision effects to readable labels', () => {
    expect(effectLabel('ALLOW')).toBe('Allowed');
    expect(effectLabel('DENY')).toBe('Denied');
    expect(effectLabel('REQUIRE_APPROVAL')).toBe('Approval Required');
  });

  it('correctly maps approval statuses to labels', () => {
    expect(approvalStatusLabel('PENDING')).toBe('Pending Review');
    expect(approvalStatusLabel('APPROVED')).toBe('Approved');
    expect(approvalStatusLabel('REJECTED')).toBe('Rejected');
    expect(approvalStatusLabel('EXPIRED')).toBe('Expired');
    expect(approvalStatusLabel('CONSUMED')).toBe('Consumed');
  });

  it('truncates UUIDs cleanly for tabular display', () => {
    const longId = 'd1a2b3c4-0001-4aaa-bbbb-000000000001';
    expect(shortId(longId)).toBe('d1a2b3c4…');
    expect(shortId('short')).toBe('short');
  });

  it('redacts sensitive values safely', () => {
    expect(redactValue('sk-ant-api03-secrettoken12345')).toBe('sk-a••••2345');
    expect(redactValue('short')).toBe('••••••••');
  });

  it('maps effects and statuses to appropriate color badge variants', () => {
    expect(effectToVariant('ALLOW')).toBe('allow');
    expect(effectToVariant('DENY')).toBe('deny');
    expect(effectToVariant('REQUIRE_APPROVAL')).toBe('pending');

    expect(statusToVariant('PENDING')).toBe('pending');
    expect(statusToVariant('APPROVED')).toBe('allow');
    expect(statusToVariant('REJECTED')).toBe('deny');
    expect(statusToVariant('EXPIRED')).toBe('expired');
  });
});
