import { readFileSync, readdirSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { buildJsonSchemaBundle, JSON_SCHEMA_BUNDLE_ID } from '../src/index.js';

const root = new URL('../', import.meta.url);

export function readJson<T = unknown>(relative: string): T {
  return JSON.parse(readFileSync(new URL(relative, root), 'utf8')) as T;
}

export function loadExamples(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const file of readdirSync(new URL('examples/', root)).sort()) {
    if (file.endsWith('.json')) out[file.slice(0, -5)] = readJson(`examples/${file}`);
  }
  return out;
}

/** Independent JSON Schema 2020-12 validator over the generated bundle (differential check vs TypeBox). */
export function createAjv() {
  const ajv = new Ajv2020({ strict: true, strictTypes: false, allErrors: true });
  const addFormats = addFormatsModule as unknown as (a: Ajv2020) => void;
  addFormats(ajv);
  ajv.addSchema(buildJsonSchemaBundle());
  return (name: string) => {
    const fn = ajv.getSchema(`${JSON_SCHEMA_BUNDLE_ID}#/$defs/${name}`);
    if (!fn) throw new Error(`no schema ${name}`);
    return (value: unknown) => fn(value) as boolean;
  };
}

export const EXAMPLE_SCHEMAS: Record<string, string> = {
  'evaluate-request': 'EvaluateDecisionRequest',
  'evaluate-response-allow': 'EvaluateDecisionResponse',
  'evaluate-response-deny': 'EvaluateDecisionResponse',
  'evaluate-response-require-approval': 'EvaluateDecisionResponse',
  'approval-page': 'ApprovalPage',
  'approval-request-approved': 'ApprovalRequest',
  'resolve-approval-request': 'ResolveApprovalRequest',
  'audit-event-page': 'AuditEventPage',
  'policy-document': 'PolicyDocument',
  'create-policy-request': 'CreatePolicyRequest',
  'policy-version': 'PolicyVersion',
  'policy-page': 'PolicyPage',
  'health-response': 'HealthResponse',
  'error-forbidden': 'ErrorEnvelope',
  'error-invalid-request': 'ErrorEnvelope',
  'error-unavailable': 'ErrorEnvelope',
};
