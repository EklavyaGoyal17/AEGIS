-- Row locks require UPDATE privileges in PostgreSQL. These fixed, narrowly scoped
-- functions let the runtime acquire locks without granting identity mutation rights.
CREATE FUNCTION lock_principal(t uuid,p uuid) RETURNS SETOF public.principals
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT * FROM public.principals WHERE tenant_id=t AND id=p AND NOT disabled FOR SHARE;
$$;
CREATE FUNCTION lock_delegation(t uuid,p uuid,a_id text,operation text,r_type text) RETURNS SETOF public.delegations
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT d.* FROM public.delegations d JOIN public.agents a ON a.tenant_id=d.tenant_id AND a.id=d.agent_id
  WHERE d.tenant_id=t AND d.principal_id=p AND d.agent_id=a_id AND NOT a.disabled
  AND d.revoked_at IS NULL AND d.expires_at>clock_timestamp() AND operation=ANY(d.actions) AND r_type=ANY(d.resource_types)
  FOR SHARE OF d,a;
$$;
CREATE FUNCTION lock_connector(t uuid,adapter_id text) RETURNS SETOF public.connectors
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT * FROM public.connectors WHERE tenant_id=t AND id=adapter_id AND adapter=adapter_id AND enabled FOR SHARE;
$$;
REVOKE ALL ON FUNCTION lock_principal(uuid,uuid),lock_delegation(uuid,uuid,text,text,text),lock_connector(uuid,text) FROM PUBLIC;
