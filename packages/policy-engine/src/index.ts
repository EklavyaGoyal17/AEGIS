export { compilePolicySet, isCompiled, MAX_STATIC_COST } from './compile.js';
export { evaluate, DEFAULT_MAX_STEPS } from './evaluate.js';
export { detectConflicts, type ConflictFinding, type FindingSeverity } from './conflicts.js';
export {
  simulate,
  type SimulationCase,
  type SimulationCaseResult,
  type SimulationReport,
} from './simulate.js';
export {
  createBackendPolicyEngine,
  type BackendAdapterOptions,
  type BackendPolicyResult,
  type LoadedContext,
} from './adapters/backend-seam.js';
export {
  EvaluationInput,
  PolicySet,
  type CompiledPolicySet,
  type CompiledRule,
  type CompileResult,
  type EngineDecision,
  type EvaluateOptions,
  type MatchedRule,
  type PolicyIssue,
  type TraceStep,
  type TraceOutcome,
} from './types.js';
