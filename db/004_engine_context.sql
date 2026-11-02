ALTER TABLE tenants ADD COLUMN policy_revision integer NOT NULL DEFAULT 0;
ALTER TABLE principals ADD COLUMN attributes jsonb NOT NULL DEFAULT '{}';
ALTER TABLE principals ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE agents ADD COLUMN owner_principal_id uuid;
ALTER TABLE agents ADD COLUMN attributes jsonb NOT NULL DEFAULT '{}';
ALTER TABLE agents ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE agents ADD FOREIGN KEY(tenant_id,owner_principal_id) REFERENCES principals(tenant_id,id);
ALTER TABLE delegations ADD COLUMN not_before timestamptz NOT NULL DEFAULT date_trunc('second',now());
ALTER TABLE delegations ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE delegations ADD COLUMN max_sensitivity text NOT NULL DEFAULT 'restricted' CHECK(max_sensitivity IN ('public','internal','confidential','restricted'));
ALTER TABLE delegations ADD COLUMN resource_ids text[];
CREATE TABLE tenant_environment (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id), attributes jsonb NOT NULL DEFAULT '{}'
);
CREATE FUNCTION lock_delegation(t uuid,p uuid,a_id text,operation text,r_type text,r_id text) RETURNS SETOF public.delegations
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT d.* FROM public.delegations d JOIN public.agents a ON a.tenant_id=d.tenant_id AND a.id=d.agent_id
  WHERE d.tenant_id=t AND d.principal_id=p AND d.agent_id=a_id AND NOT a.disabled
  AND d.revoked_at IS NULL AND d.not_before<=clock_timestamp() AND d.expires_at>clock_timestamp()
  AND operation=ANY(d.actions) AND r_type=ANY(d.resource_types) AND (d.resource_ids IS NULL OR r_id=ANY(d.resource_ids))
  FOR SHARE OF d,a;
$$;
REVOKE ALL ON FUNCTION lock_delegation(uuid,uuid,text,text,text,text) FROM PUBLIC;
