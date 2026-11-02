import pg from 'pg';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import {
  canonical,
  digest,
  publicDigest,
  DomainError,
  type Principal,
} from './domain.js';

export type Tx = pg.PoolClient;
export const SYSTEM_TENANT = '00000000-0000-0000-0000-000000000000';
export class Store {
  private readonly context = new AsyncLocalStorage<{
    tenantId: string;
    tx: Tx;
  }>();
  constructor(readonly pool: pg.Pool) {}
  contextQuery(tenantId: string, query: string, values: unknown[]) {
    const active = this.context.getStore();
    if (!active || active.tenantId !== tenantId)
      throw new Error('Engine context requires the active tenant transaction');
    return active.tx.query(query, values);
  }
  async transaction<T>(
    tenantId: string,
    fn: (tx: Tx) => Promise<T>,
  ): Promise<T> {
    const tx = await this.pool.connect();
    try {
      await tx.query('BEGIN');
      await tx.query("SET LOCAL statement_timeout = '5s'");
      await tx.query("SET LOCAL lock_timeout = '3s'");
      await tx.query("SET LOCAL idle_in_transaction_session_timeout = '10s'");
      const tenant = await tx.query(
        'SELECT id FROM tenants WHERE id=$1 FOR UPDATE',
        [tenantId],
      );
      if (!tenant.rowCount) throw new DomainError(403, 'UNKNOWN_TENANT');
      const result = await this.context.run({ tenantId, tx }, () => fn(tx));
      await tx.query('COMMIT');
      return result;
    } catch (error) {
      await tx.query('ROLLBACK');
      throw error;
    } finally {
      tx.release();
    }
  }
  async authenticate(issuer: string, subject: string): Promise<Principal> {
    const result = await this.pool.query(
      'SELECT * FROM principals WHERE issuer=$1 AND subject=$2 AND NOT disabled',
      [issuer, subject],
    );
    const row = result.rows[0];
    if (!row || row.tenant_id === SYSTEM_TENANT)
      throw new DomainError(401, 'UNKNOWN_PRINCIPAL');
    return {
      tenantId: row.tenant_id,
      id: row.id,
      issuer: row.issuer,
      subject: row.subject,
      kind: row.kind,
      roles: row.roles,
      connector: row.connector,
    };
  }
  async currentPrincipal(tx: Tx, principal: Principal) {
    const result = await tx.query('SELECT * FROM lock_principal($1,$2)', [
      principal.tenantId,
      principal.id,
    ]);
    const row = result.rows[0];
    if (!row) throw new DomainError(401, 'PRINCIPAL_DISABLED');
    // Compare the snapshot so a privilege revocation between authentication and mutation fails closed.
    if (
      canonical(row.roles) !== canonical(principal.roles) ||
      row.connector !== principal.connector ||
      row.kind !== principal.kind
    )
      throw new DomainError(403, 'IDENTITY_CHANGED');
  }
  async authorizeAgent(
    tx: Tx,
    principal: Principal,
    agentId: string,
    action: string,
    resourceType: string,
    resourceId: string,
  ) {
    await this.currentPrincipal(tx, principal);
    const grant = await tx.query(
      'SELECT id FROM lock_delegation($1,$2,$3,$4,$5,$6)',
      [
        principal.tenantId,
        principal.id,
        agentId,
        action,
        resourceType,
        resourceId,
      ],
    );
    if (!grant.rowCount) throw new DomainError(403, 'DELEGATION_REQUIRED');
  }
  async rateLimit(principal: Principal) {
    const result = await this.pool.query(
      `INSERT INTO rate_buckets(tenant_id,principal_id,bucket,hits)
      VALUES($1,$2,floor(extract(epoch FROM clock_timestamp())/60)::bigint,1)
      ON CONFLICT(tenant_id,principal_id) DO UPDATE SET
      hits=CASE WHEN rate_buckets.bucket=excluded.bucket THEN rate_buckets.hits+1 ELSE 1 END, bucket=excluded.bucket RETURNING hits`,
      [principal.tenantId, principal.id],
    );
    if (Number(result.rows[0]?.hits) > 120)
      throw new DomainError(429, 'RATE_LIMITED');
  }
}
export async function audit(
  tx: Tx,
  tenantId: string,
  type: string,
  actorId: string | null,
  correlationId: string,
  data: Record<string, unknown>,
) {
  const head = (
    await tx.query(
      'SELECT audit_seq,audit_head FROM tenants WHERE id=$1 FOR UPDATE',
      [tenantId],
    )
  ).rows[0];
  const seq = (BigInt(head.audit_seq) + 1n).toString();
  const event = {
    id: randomUUID(),
    tenantId,
    seq,
    type,
    actorId,
    correlationId,
    occurredAt: new Date().toISOString(),
    data,
    previousHash: head.audit_head as string,
  };
  const hash = digest(event);
  await tx.query(
    'INSERT INTO audit_events(tenant_id,seq,id,event,previous_hash,hash) VALUES($1,$2,$3,$4,$5,$6)',
    [tenantId, seq, event.id, event, event.previousHash, hash],
  );
  await tx.query('UPDATE tenants SET audit_seq=$2,audit_head=$3 WHERE id=$1', [
    tenantId,
    seq,
    hash,
  ]);
  const publicTypes: Record<string, string> = {
    DECISION: 'DECISION_EVALUATED',
    APPROVAL_CREATED: 'APPROVAL_REQUESTED',
    APPROVAL_RESOLVED: 'APPROVAL_RESOLVED',
    APPROVAL_CONSUMED: 'APPROVAL_CONSUMED',
    APPROVAL_EXPIRED: 'APPROVAL_EXPIRED',
    EXECUTION_STARTED: 'EXECUTION_AUTHORIZED',
    POLICY_CREATED: 'POLICY_CREATED',
    POLICY_ACTIVATED: 'POLICY_ACTIVATED',
    AUTHENTICATION_ERROR: 'AUTHENTICATION_FAILED',
    REQUEST_REJECTED: 'AUTHORIZATION_ERROR',
  };
  const publicType = publicTypes[type];
  if (publicType) {
    const publicHead = (
      await tx.query(
        'SELECT api_audit_seq,api_audit_head FROM tenants WHERE id=$1',
        [tenantId],
      )
    ).rows[0];
    const unhashed = {
      eventId: randomUUID(),
      tenantId,
      sequence: Number(publicHead.api_audit_seq),
      occurredAt: event.occurredAt,
      type: publicType,
      actor: {
        kind: actorId ? 'PRINCIPAL' : 'SYSTEM',
        id: actorId ?? 'system',
      },
      requestId: data.requestId ?? null,
      decisionId: data.decisionId ?? null,
      approvalId: data.approvalId ?? null,
      policyVersion: data.policyVersion ?? null,
      action: data.action ?? null,
      resource: data.resource ?? null,
      effect: data.effect ?? null,
      reasonCodes: data.reasonCodes ?? [],
      payloadDigest: publicDigest(data),
      agentId: data.agentId ?? null,
      previousEventHash: publicHead.api_audit_head,
      correlationId,
    };
    if (!Number.isSafeInteger(unhashed.sequence))
      throw new Error('Audit sequence exceeds JSON safe integer range');
    const eventHash = publicDigest({
      kind: 'aegis.audit-event/v1',
      event: unhashed,
    });
    await tx.query(
      'INSERT INTO api_audit_events(tenant_id,seq,event) VALUES($1,$2,$3)',
      [tenantId, publicHead.api_audit_seq, { ...unhashed, eventHash }],
    );
    await tx.query(
      'UPDATE tenants SET api_audit_seq=api_audit_seq+1,api_audit_head=$2 WHERE id=$1',
      [tenantId, eventHash],
    );
  }
}
export async function verifyAudit(store: Store, tenantId: string) {
  return store.transaction(tenantId, async (tx) => {
    let previous = '0'.repeat(64);
    let seq = 0n;
    // Keyset batches avoid loading an unbounded event history.
    for (;;) {
      const rows = await tx.query(
        'SELECT * FROM audit_events WHERE tenant_id=$1 AND seq>$2 ORDER BY seq LIMIT 500',
        [tenantId, seq.toString()],
      );
      if (!rows.rowCount) break;
      for (const row of rows.rows) {
        seq++;
        const event = row.event as Record<string, unknown>;
        if (
          row.seq !== seq.toString() ||
          event.seq !== seq.toString() ||
          event.tenantId !== tenantId ||
          event.id !== row.id ||
          event.previousHash !== previous ||
          row.previous_hash !== previous ||
          digest(event) !== row.hash
        )
          return false;
        previous = row.hash;
      }
    }
    const head = (
      await tx.query('SELECT audit_seq,audit_head FROM tenants WHERE id=$1', [
        tenantId,
      ])
    ).rows[0];
    if (head.audit_seq !== seq.toString() || head.audit_head !== previous)
      return false;
    let cursor = -1;
    let publicPrevious: string | null = null;
    for (;;) {
      const rows = await tx.query(
        'SELECT seq,event FROM api_audit_events WHERE tenant_id=$1 AND seq>$2 ORDER BY seq LIMIT 500',
        [tenantId, cursor],
      );
      if (!rows.rowCount) break;
      for (const row of rows.rows) {
        const { eventHash, ...unhashed } = row.event;
        if (
          unhashed.tenantId !== tenantId ||
          unhashed.sequence !== cursor + 1 ||
          Number(row.seq) !== cursor + 1 ||
          unhashed.previousEventHash !== publicPrevious ||
          eventHash !==
            publicDigest({ kind: 'aegis.audit-event/v1', event: unhashed })
        )
          return false;
        cursor++;
        publicPrevious = eventHash;
      }
    }
    const publicHead = (
      await tx.query(
        'SELECT api_audit_seq,api_audit_head FROM tenants WHERE id=$1',
        [tenantId],
      )
    ).rows[0];
    return (
      Number(publicHead.api_audit_seq) === cursor + 1 &&
      publicHead.api_audit_head === publicPrevious
    );
  });
}
