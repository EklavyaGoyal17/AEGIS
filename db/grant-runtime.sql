GRANT USAGE ON SCHEMA public TO aegis_app;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO aegis_app;
GRANT UPDATE ON tenants TO aegis_app;
GRANT INSERT ON policies,decisions,approval_actions,audit_events,api_audit_events,policy_revisions,idempotency_records TO aegis_app;
GRANT INSERT,UPDATE ON approvals,executions,rate_buckets,policy_catalog TO aegis_app;
GRANT EXECUTE ON FUNCTION lock_principal(uuid,uuid),lock_delegation(uuid,uuid,text,text,text),lock_connector(uuid,text) TO aegis_app;
GRANT EXECUTE ON FUNCTION lock_delegation(uuid,uuid,text,text,text,text) TO aegis_app;
