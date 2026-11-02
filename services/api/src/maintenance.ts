import { randomUUID } from 'node:crypto';
import type { Authorization } from './authorization.js';
import { audit } from './store.js';
/** A crashed or disconnected worker never causes an automatic side-effect retry. */
export async function maintenance(
  authorization: Authorization,
  staleSeconds = 60,
) {
  if (staleSeconds < 30)
    throw new Error('Recovery threshold must exceed the execution deadline');
  const { store } = authorization;
  const tenants = await store.pool.query(
    `SELECT DISTINCT tenant_id FROM (
    SELECT tenant_id FROM executions WHERE state='STARTED' AND created_at<clock_timestamp()-$1*interval '1 second'
    UNION SELECT tenant_id FROM approvals WHERE state IN ('PENDING','APPROVED') AND expires_at<=clock_timestamp()) work LIMIT 100`,
    [staleSeconds],
  );
  for (const row of tenants.rows)
    await store.transaction(row.tenant_id, async (tx) => {
      const correlation = randomUUID();
      await authorization.expire(tx, row.tenant_id, correlation);
      const stale = await tx.query(
        "UPDATE executions SET state='UNKNOWN',outcome_code='WORKER_LOST_RECONCILIATION_REQUIRED',completed_at=clock_timestamp() WHERE tenant_id=$1 AND state='STARTED' AND created_at<clock_timestamp()-$2*interval '1 second' RETURNING id",
        [row.tenant_id, staleSeconds],
      );
      for (const execution of stale.rows)
        await audit(
          tx,
          row.tenant_id,
          'EXECUTION_RECOVERED',
          null,
          correlation,
          { executionId: execution.id, state: 'UNKNOWN' },
        );
    });
}
