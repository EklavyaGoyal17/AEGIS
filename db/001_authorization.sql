CREATE TABLE tenants (
  id uuid PRIMARY KEY, name text NOT NULL, active_policy text,
  audit_seq bigint NOT NULL DEFAULT 0, audit_head text NOT NULL DEFAULT repeat('0',64)
);
CREATE TABLE principals (
  tenant_id uuid NOT NULL REFERENCES tenants(id), id uuid NOT NULL,
  issuer text NOT NULL, subject text NOT NULL, kind text NOT NULL CHECK (kind IN ('human','machine')),
  roles text[] NOT NULL DEFAULT '{}', connector boolean NOT NULL DEFAULT false,
  disabled boolean NOT NULL DEFAULT false,
  PRIMARY KEY (tenant_id,id), UNIQUE(issuer,subject)
);
CREATE TABLE agents (
  tenant_id uuid NOT NULL REFERENCES tenants(id), id text NOT NULL,
  disabled boolean NOT NULL DEFAULT false, PRIMARY KEY(tenant_id,id)
);
CREATE TABLE delegations (
  tenant_id uuid NOT NULL, id uuid NOT NULL, principal_id uuid NOT NULL, agent_id text NOT NULL,
  actions text[] NOT NULL, resource_types text[] NOT NULL,
  expires_at timestamptz NOT NULL, revoked_at timestamptz,
  PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,principal_id,agent_id),
  FOREIGN KEY(tenant_id,principal_id) REFERENCES principals(tenant_id,id),
  FOREIGN KEY(tenant_id,agent_id) REFERENCES agents(tenant_id,id)
);
CREATE TABLE policies (
  tenant_id uuid NOT NULL REFERENCES tenants(id), version text NOT NULL,
  document jsonb NOT NULL, digest text NOT NULL, created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,version),
  FOREIGN KEY(tenant_id,created_by) REFERENCES principals(tenant_id,id)
);
ALTER TABLE tenants ADD CONSTRAINT active_policy_fk FOREIGN KEY(id,active_policy) REFERENCES policies(tenant_id,version);
CREATE TABLE decisions (
  tenant_id uuid NOT NULL, id uuid NOT NULL, request_id uuid NOT NULL, principal_id uuid NOT NULL,
  agent_id text NOT NULL, request_digest text NOT NULL, arguments_digest text NOT NULL,
  action text NOT NULL, resource_type text NOT NULL, resource_id text NOT NULL,
  policy_version text NOT NULL, effect text NOT NULL CHECK(effect IN ('ALLOW','DENY','REQUIRE_APPROVAL')),
  reasons jsonb NOT NULL, trace jsonb NOT NULL, approval_id uuid,
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,principal_id,request_id),
  FOREIGN KEY(tenant_id,principal_id) REFERENCES principals(tenant_id,id),
  FOREIGN KEY(tenant_id,agent_id) REFERENCES agents(tenant_id,id)
);
CREATE TABLE approvals (
  tenant_id uuid NOT NULL, id uuid NOT NULL, decision_id uuid NOT NULL,
  state text NOT NULL CHECK(state IN ('PENDING','APPROVED','REJECTED','EXPIRED','CANCELLED','CONSUMED')),
  required_role text NOT NULL, prohibit_self boolean NOT NULL DEFAULT true,
  expires_at timestamptz NOT NULL, resolved_by uuid, resolved_at timestamptz,
  PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,decision_id),
  FOREIGN KEY(tenant_id,decision_id) REFERENCES decisions(tenant_id,id),
  FOREIGN KEY(tenant_id,resolved_by) REFERENCES principals(tenant_id,id)
);
ALTER TABLE decisions ADD CONSTRAINT decision_approval_fk FOREIGN KEY(tenant_id,approval_id) REFERENCES approvals(tenant_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE approval_actions (
  tenant_id uuid NOT NULL, id uuid NOT NULL, approval_id uuid NOT NULL, actor_id uuid NOT NULL,
  request_id uuid NOT NULL, action text NOT NULL CHECK(action IN ('APPROVE','REJECT','CANCEL')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,actor_id,request_id),
  FOREIGN KEY(tenant_id,approval_id) REFERENCES approvals(tenant_id,id),
  FOREIGN KEY(tenant_id,actor_id) REFERENCES principals(tenant_id,id)
);
CREATE TABLE connectors (
  tenant_id uuid NOT NULL REFERENCES tenants(id), id text NOT NULL,
  adapter text NOT NULL CHECK(adapter = 'demo-note'), enabled boolean NOT NULL DEFAULT false,
  PRIMARY KEY(tenant_id,id)
);
CREATE TABLE executions (
  tenant_id uuid NOT NULL, id uuid NOT NULL, decision_id uuid NOT NULL,
  connector_id text NOT NULL, state text NOT NULL CHECK(state IN ('STARTED','SUCCEEDED','FAILED','UNKNOWN')),
  outcome_code text, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), completed_at timestamptz,
  PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,decision_id),
  FOREIGN KEY(tenant_id,decision_id) REFERENCES decisions(tenant_id,id),
  FOREIGN KEY(tenant_id,connector_id) REFERENCES connectors(tenant_id,id)
);
CREATE TABLE audit_events (
  tenant_id uuid NOT NULL REFERENCES tenants(id), seq bigint NOT NULL, id uuid NOT NULL,
  event jsonb NOT NULL, previous_hash text NOT NULL, hash text NOT NULL,
  PRIMARY KEY(tenant_id,seq), UNIQUE(tenant_id,id)
);
CREATE TABLE rate_buckets (
  tenant_id uuid NOT NULL REFERENCES tenants(id), principal_id uuid NOT NULL,
  bucket bigint NOT NULL, hits integer NOT NULL, PRIMARY KEY(tenant_id,principal_id),
  FOREIGN KEY(tenant_id,principal_id) REFERENCES principals(tenant_id,id)
);
CREATE INDEX approvals_pending ON approvals(tenant_id,expires_at,id) WHERE state IN ('PENDING','APPROVED');
CREATE INDEX executions_recovery ON executions(tenant_id,created_at) WHERE state='STARTED';
CREATE FUNCTION immutable_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'append-only relation'; END;
$$;
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION immutable_record();
CREATE TRIGGER policies_immutable BEFORE UPDATE OR DELETE ON policies FOR EACH ROW EXECUTE FUNCTION immutable_record();
CREATE TRIGGER decisions_immutable BEFORE UPDATE OR DELETE ON decisions FOR EACH ROW EXECUTE FUNCTION immutable_record();
CREATE TRIGGER approval_actions_immutable BEFORE UPDATE OR DELETE ON approval_actions FOR EACH ROW EXECUTE FUNCTION immutable_record();
CREATE FUNCTION approval_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.id IS DISTINCT FROM OLD.id
    OR NEW.decision_id IS DISTINCT FROM OLD.decision_id OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
    OR NEW.required_role IS DISTINCT FROM OLD.required_role OR NEW.prohibit_self IS DISTINCT FROM OLD.prohibit_self
    THEN RAISE EXCEPTION 'immutable approval binding'; END IF;
  IF NEW.state <> OLD.state AND NOT (
    (OLD.state='PENDING' AND NEW.state IN ('APPROVED','REJECTED','EXPIRED','CANCELLED')) OR
    (OLD.state='APPROVED' AND NEW.state IN ('CONSUMED','EXPIRED','CANCELLED'))
  ) THEN RAISE EXCEPTION 'illegal approval transition'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER approval_transition BEFORE UPDATE ON approvals FOR EACH ROW EXECUTE FUNCTION approval_transition();
INSERT INTO tenants(id,name) VALUES ('00000000-0000-0000-0000-000000000000','system-authentication');
