import pg from 'pg';
import { Authorization } from '../services/api/src/authorization.js';
import { Store, audit } from '../services/api/src/store.js';
import { canonicalPolicyEngine } from '../services/api/src/canonical-engine.js';
import { DEMO_POLICY } from './local-demo-policy.js';
export const DEMO_TENANT = '10000000-0000-4000-8000-000000000001';
export const DEMO_MACHINE = '10000000-0000-4000-8000-000000000002';
export const DEMO_HUMAN = '10000000-0000-4000-8000-000000000003';
if (
  process.env.NODE_ENV === 'production' ||
  process.env.AEGIS_DEV_SEED !== 'true'
)
  throw new Error(
    'Developer seed requires NODE_ENV!=production and AEGIS_DEV_SEED=true',
  );
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const store = new Store(pool);
  await pool.query(
    'INSERT INTO tenants(id,name) VALUES($1,$2) ON CONFLICT DO NOTHING',
    [DEMO_TENANT, 'Isolated local demo'],
  );
  const issuer = 'https://identity.aegis.local.invalid';
  await store.transaction(DEMO_TENANT, async (tx) => {
    await tx.query(
      `INSERT INTO principals(tenant_id,id,issuer,subject,kind,roles,connector) VALUES($1,$2,$4,'demo-machine','machine',$5,true),($1,$3,$4,'demo-human','human',$6,false) ON CONFLICT DO NOTHING`,
      [
        DEMO_TENANT,
        DEMO_MACHINE,
        DEMO_HUMAN,
        issuer,
        ['tool:execute'],
        [
          'approval:read',
          'approval:write',
          'policy:admin',
          'policy:read',
          'audit:read',
        ],
      ],
    );
    await tx.query(
      'INSERT INTO agents(tenant_id,id,owner_principal_id) VALUES($1,$2,$3) ON CONFLICT(tenant_id,id) DO UPDATE SET owner_principal_id=COALESCE(agents.owner_principal_id,excluded.owner_principal_id)',
      [DEMO_TENANT, 'demo-agent', DEMO_MACHINE],
    );
    await tx.query(
      `INSERT INTO delegations(tenant_id,id,principal_id,agent_id,actions,resource_types,expires_at) VALUES($1,$2,$3,'demo-agent',ARRAY['demo.note.create'],ARRAY['note'],now()+interval '24 hours') ON CONFLICT(tenant_id,principal_id,agent_id) DO NOTHING`,
      [DEMO_TENANT, '10000000-0000-4000-8000-000000000004', DEMO_MACHINE],
    );
    await tx.query(
      "INSERT INTO connectors(tenant_id,id,adapter,enabled) VALUES($1,'demo-note','demo-note',true) ON CONFLICT DO NOTHING",
      [DEMO_TENANT],
    );
    await audit(
      tx,
      DEMO_TENANT,
      'DEVELOPER_SEED',
      DEMO_HUMAN,
      '10000000-0000-4000-8000-000000000005',
      { purpose: 'local-demo' },
    );
  });
  const human = await store.authenticate(issuer, 'demo-human');
  if (
    !(
      await pool.query('SELECT id FROM policy_catalog WHERE tenant_id=$1', [
        DEMO_TENANT,
      ])
    ).rowCount
  )
    await new Authorization(
      store,
      await canonicalPolicyEngine(store),
    ).writePolicy(
      human,
      {
        policyId: 'demo-policy',
        name: 'Isolated demo approval',
        document: DEMO_POLICY,
        activate: true,
        expectedLatestVersion: null,
      },
      '10000000-0000-4000-8000-000000000006',
    );
  console.log(
    'Local demo seeded. Delegation expires after 24 hours; expired or revoked grants are never silently renewed.',
  );
} finally {
  await pool.end();
}
