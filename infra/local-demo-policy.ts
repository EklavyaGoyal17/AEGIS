import {
  digest,
  type PolicyEngine,
  type PolicyResult,
} from '../services/api/src/domain.js';
/** Fixed integration fixture only. This module does not implement the policy DSL. */
export const DEMO_POLICY = {
  schemaVersion: 'aegis.policy/v1',
  decisionTtlSeconds: 120,
  rules: [
    {
      id: 'require-demo-human',
      effect: 'REQUIRE_APPROVAL',
      actions: ['demo.note.create'],
      resourceTypes: ['note'],
      approval: { ttlSeconds: 120 },
    },
  ],
};
export class LocalDemoFixture implements PolicyEngine {
  readonly name = 'local-only-fixed-demo-fixture';
  constructor() {
    if (
      process.env.NODE_ENV === 'production' ||
      process.env.ENABLE_LOCAL_DEMO_POLICY !== 'true'
    )
      throw new Error('Local fixture requires explicit development opt-in');
  }
  async validatePolicy(document: unknown) {
    return digest(document) === digest(DEMO_POLICY);
  }
  async evaluate(
    input: Parameters<PolicyEngine['evaluate']>[0],
  ): Promise<PolicyResult> {
    const document = input.policy?.document as
      { policies?: Array<{ document: unknown }> } | undefined;
    if (
      input.request.action !== 'demo.note.create' ||
      input.request.resource.type !== 'note' ||
      document?.policies?.length !== 1 ||
      !(await this.validatePolicy(document.policies[0]!.document))
    )
      return {
        effect: 'DENY',
        reasonCodes: ['NO_MATCHING_RULE'],
        trace: [],
        ttlSeconds: 30,
      };
    return {
      effect: 'REQUIRE_APPROVAL',
      reasonCodes: ['APPROVAL_REQUIRED'],
      trace: ['demo-policy/require-demo-human'],
      ttlSeconds: 120,
      approval: { requiredRole: 'approval:write', prohibitSelf: true },
    };
  }
}
