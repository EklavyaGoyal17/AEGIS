CREATE TABLE policy_catalog (
  tenant_id uuid NOT NULL REFERENCES tenants(id), id text NOT NULL, name text NOT NULL, description text,
  latest_version integer NOT NULL, active_version integer,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,id)
);
CREATE TABLE policy_revisions (
  tenant_id uuid NOT NULL, policy_id text NOT NULL, version integer NOT NULL,
  document jsonb NOT NULL, digest text NOT NULL, created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,policy_id,version),
  FOREIGN KEY(tenant_id,policy_id) REFERENCES policy_catalog(tenant_id,id),
  FOREIGN KEY(tenant_id,created_by) REFERENCES principals(tenant_id,id)
);
CREATE TRIGGER policy_revisions_immutable BEFORE UPDATE OR DELETE ON policy_revisions FOR EACH ROW EXECUTE FUNCTION immutable_record();
CREATE TABLE idempotency_records (
  tenant_id uuid NOT NULL, principal_id uuid NOT NULL, scope text NOT NULL, request_id uuid NOT NULL,
  digest text NOT NULL, response jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,principal_id,scope,request_id),
  FOREIGN KEY(tenant_id,principal_id) REFERENCES principals(tenant_id,id)
);
ALTER TABLE approval_actions ADD COLUMN comment text;
CREATE TABLE resource_metadata (
  tenant_id uuid NOT NULL REFERENCES tenants(id), type text NOT NULL, id text NOT NULL,
  attributes jsonb NOT NULL, PRIMARY KEY(tenant_id,type,id)
);
ALTER TABLE tenants ADD COLUMN api_audit_seq bigint NOT NULL DEFAULT 0;
ALTER TABLE tenants ADD COLUMN api_audit_head text;
CREATE TABLE api_audit_events (
  tenant_id uuid NOT NULL REFERENCES tenants(id), seq bigint NOT NULL, event jsonb NOT NULL,
  PRIMARY KEY(tenant_id,seq)
);
CREATE TRIGGER api_audit_immutable BEFORE UPDATE OR DELETE ON api_audit_events FOR EACH ROW EXECUTE FUNCTION immutable_record();
