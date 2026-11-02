/**
 * Hard limits shared by the API contract and the policy engine. They bound memory and CPU per
 * request and per policy so that a single tenant cannot exhaust a shared evaluator.
 * Changing any of these is a contract change (see COMPATIBILITY.md).
 */
export const LIMITS = Object.freeze({
  identifierMaxLength: 128,
  resourceIdMaxLength: 256,
  actionMaxLength: 128,
  attributeKeyMaxLength: 64,
  attributesMaxProperties: 64,
  attributeStringMaxLength: 1024,
  attributeArrayMaxItems: 256,
  reasonCodesMaxItems: 32,
  commentMaxLength: 2000,
  descriptionMaxLength: 500,
  cursorMaxLength: 512,
  pageSizeMax: 200,
  pageSizeDefault: 50,

  policyRulesMax: 256,
  policyRulePatternsMax: 64,
  policyActionCatalogMax: 1024,
  policyConditionDepthMax: 8,
  policyConditionNodesMax: 128,
  policyLiteralListMax: 256,
  policyTimeWindowsMax: 16,
  policySetPoliciesMax: 64,

  delegationGrantsMax: 64,
  delegationScopesMax: 64,
  delegationScopeIdsMax: 256,

  approvalTtlSecondsMin: 60,
  approvalTtlSecondsMax: 7 * 24 * 3600,
  decisionTtlSecondsDefault: 60,
  decisionTtlSecondsMax: 300,

  executionAuthorizationMaxLifetimeSeconds: 300,
  executionAuthorizationTokenMaxLength: 4096,

  canonicalJsonMaxDepth: 32,
});
