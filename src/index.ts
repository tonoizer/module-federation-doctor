export {
  FINDING_DETAILS_SCHEMAS,
  TYPED_DETAILS_RULE_IDS,
  findingDetails,
  isKnownFindingDetailsSchema,
  readFindingDetails,
} from "./finding-details.js";
export type {
  ArtifactDetailsV1,
  DoctorPartialAnalysisDetailsV1,
  FindingDetailsAttachment,
  FindingDetailsSchemaId,
  FindingDetailsV1,
  RemotesConfigDetailsV1,
  SharedSingletonDetailsV1,
  SharedUnusedDetailsV1,
  SharedVersionMismatchDetailsV1,
  TypedDetailsRuleId,
} from "./finding-details.js";
export { analyze, analyzeFederation } from "./engine.js";
export {
  AnalysisContentCache,
  DEFAULT_ANALYSIS_CACHE_OPTIONS,
  analysisCacheKey,
  contentDigest,
  createAnalysisCacheIdentity,
  stableSerialize,
} from "./analysis-cache.js";
export type { AnalysisCacheOptions, AnalysisCacheStats } from "./analysis-cache.js";
export {
  createWorkspaceApplicationIdentity,
  workspaceProjectRoot,
  workspaceRootForProjects,
} from "./monorepo-identity.js";
export { readCanonicalModuleFederationConfig } from "./canonical-config.js";
export {
  BUILT_IN_CAPABILITY_PACKS,
  ENHANCED_WEBPACK_V5_BROWSER_PACK,
  assertCapabilityPacks,
  queryCapability,
  resolveCapabilityPack,
} from "./capability-packs.js";
export type {
  CapabilityPackProvenance,
  CapabilityField,
  CapabilityPack,
  CapabilityQuery,
  CapabilityResolution,
  CapabilityStatus,
  CapabilityVersionSelector,
  ResolvedCapability,
} from "./capability-packs.js";
export {
  resolveOptions,
  resolveQuiet,
  resolvePrintLog,
  isCiEnvironment,
  DEFAULT_EXCLUDE,
  DEFAULT_INCLUDE,
} from "./config.js";
export {
  applyBaseline,
  entryMatchesFinding,
  generateBaseline,
  loadBaseline,
  parseBaseline,
  policyFails,
  policyRelevantFindings,
  pruneBaseline,
  resolveBaselineOptions,
  summarizeFindings,
  updateBaseline,
  writeBaselineFile,
} from "./baseline.js";
export { computeHealthScore, isExcludedFromScore, labelForScore } from "./health-score.js";
export type { HealthScoreResult } from "./health-score.js";
export {
  buildAgentPrompt,
  findPromptTarget,
  formatTopAgentPrompts,
  resolveDiagnosticsDir,
  selectTopFindings,
  writeDiagnosticsDump,
} from "./agent-prompt.js";
export type { AgentPromptOptions, DiagnosticsDumpResult } from "./agent-prompt.js";
export {
  DEFAULT_WORKSPACE_PROJECT_GLOBS,
  WORKSPACE_IGNORE,
  discoverWorkspaceProjects,
} from "./workspace.js";
export { discoverWorkspaceProjectsWithBudget } from "./workspace.js";
export type { DiscoverWorkspaceProjectsOptions, WorkspaceProjectDiscovery } from "./workspace.js";
export type { WorkspaceProjectDiagnostic, WorkspaceProjectDiagnosticKind } from "./workspace.js";
export {
  AnalysisBudgetTracker,
  DEFAULT_ANALYSIS_BUDGETS,
  measureEvidenceUsage,
  resolveAnalysisBudgets,
} from "./analysis-budgets.js";
export type {
  AnalysisBudgetExceeded,
  AnalysisBudgetKind,
  AnalysisBudgetOptions,
  AnalysisBudgetReport,
  AnalysisBudgetUsage,
  AnalysisBudgets,
  EvidenceBudgetMeasurement,
} from "./analysis-budgets.js";
export {
  DOCTOR_PRESET_NAMES,
  definePolicyPack,
  demoPreset,
  isDoctorPresetName,
  presets,
  productionPreset,
  recommendedPreset,
  resolvePolicy,
  strictPreset,
} from "./policy.js";
export { defineRule, builtInRules } from "./rules.js";
export {
  hasMf2SharedArrayManifest,
  hasMfBridgeEntryExpose,
  hasMfSsrFragmentRemotes,
  hasMfToolkitShapeSignals,
  isMf2SharedArrayManifestOnly,
  isMfBridgeEntryProducer,
  isMfSsrFragmentProducer,
  isMfSsrFragmentRemoteEntry,
  toolkitRecognitionEnabled,
} from "./mf-toolkit-shapes.js";
export { ProbeError, probeManifest } from "./probe.js";
export {
  RuntimeTraceError,
  analyzeRuntime,
  correlateRuntime,
  loadRuntimeTraceFile,
  parseRuntimeTraces,
} from "./runtime-trace.js";
export { buildUiPayload } from "./ui-graph.js";
export {
  coerceFederationInstanceInputs,
  describeFederationInstances,
  duplicateFederationInstanceGroups,
  federationConfigDigest,
  federationInstanceRefs,
} from "./federation-instance.js";
export type { FederationInstanceDescriptor } from "./federation-instance.js";
export {
  EVIDENCE_LEGACY_ENV,
  RELEASE_GATES,
  ROLLOUT_SCOPES,
  RolloutGateError,
  createEvidenceRolloutController,
} from "./evidence-rollout.js";
export type {
  EvidenceRolloutController,
  EvidenceRolloutOptions,
  ReleaseGate,
  ReleaseGateStatus,
  RolloutMode,
  RolloutScope,
  ScopedRolloutModes,
} from "./evidence-rollout.js";
export type { ManifestProbeResult, ProbeOptions } from "./probe.js";
export type { ApplyBaselineResult, ResolvedBaselineOptions } from "./baseline.js";
export {
  DEFAULT_ALWAYS_SHARED,
  DEFAULT_DEEP_IMPORT_ALLOWLIST,
  DEFAULT_IMPORT_DEPTH,
  DEFAULT_SHARE_CANDIDATE_PACKAGES,
  DEFAULT_SINGLETON_RISK_PACKAGES,
  mergeSharedPolicy,
} from "./shared-policy.js";
export type {
  AnalysisCapabilities,
  AnalysisResult,
  ArtifactManifest,
  ArtifactManifestRecord,
  ArtifactKind,
  ArtifactRecord,
  ArtifactSource,
  ArtifactState,
  ArtifactStatsRecord,
  ArtifactStats,
  ArtifactFacts,
  BuildCapability,
  BuildCapabilityState,
  BuildOutputInput,
  BuildRecord,
  ModernContextFacts,
  BaselineEntry,
  BaselineFile,
  BaselineOptions,
  BundlerFacts,
  BundlerName,
  ViteLifecycleEngine,
  ViteLifecycleFacts,
  ViteLifecycleFlavor,
  DependencyFacts,
  DoctorExtendEntry,
  DoctorFinding,
  DoctorOptions,
  DoctorPolicyPack,
  DoctorProfile,
  DoctorPresetName,
  DoctorPrintLog,
  DoctorReport,
  DoctorRule,
  DoctorSharedPolicy,
  DoctorUiPayload,
  FederationInstanceFacts,
  FederationInstanceRef,
  FederationAnalysisResult,
  HealthScoreLabel,
  ImportDepth,
  ImportEvidenceSource,
  ImportSourceScope,
  ImportFacts,
  ModuleFederationConfigLike,
  ModuleFederationInstanceInput,
  UnresolvedDynamicApi,
  UnresolvedDynamicImport,
  NormalizedMFConfig,
  OutputFormat,
  OutputPublicPathKind,
  ProjectFacts,
  ProjectIdentity,
  ResolvedDoctorOptions,
  RuleContext,
  RuleMeta,
  RuleSetting,
  RuntimeAnalysisResult,
  RuntimeTraceReport,
  Severity,
  SourceLocation,
  UiGraph,
  UiGraphEdge,
  UiGraphNode,
  UiGraphNodeKind,
} from "./types.js";
export type {
  CanonicalConfigCell,
  CanonicalConfigContext,
  CanonicalConfigDiagnosticCode,
  CanonicalConfigDiagnostic,
  CanonicalConfigEntry,
  CanonicalConfigOrigin,
  CanonicalConfigSnapshot,
  CanonicalConfigState,
  CanonicalConfigLimits,
  CanonicalEffectiveCell,
  CanonicalEffectiveState,
  CanonicalMFConfigV1,
  CanonicalUnknownField,
} from "./canonical-config.js";
export {
  canonicalIdentityKey,
  createAdapterTargetIdentity,
  createApplicationIdentity,
  createArtifactIdentity,
  createBuildIdentity,
  createBuildLineageIdentity,
  createContainerIdentity,
  createDeploymentIdentity,
  createEnvironmentIdentity,
  createIdentity,
  createOrganizationIdentity,
  createRuntimeInstanceIdentity,
  createRuntimeRealmIdentity,
  IDENTITY_SCHEMA_VERSION,
  unknownIdentity,
} from "./identity.js";
export type {
  AdapterTargetIdentity,
  AdapterTargetDimensions,
  AnySemanticIdentity,
  ApplicationDimensions,
  ApplicationIdentity,
  ArtifactDimensions,
  ArtifactIdentity,
  BuildDimensions,
  BuildIdentity,
  BuildLineageDimensions,
  BuildLineageIdentity,
  ContainerDimensions,
  ContainerIdentity,
  CreateIdentityOptions,
  DeploymentIdentity,
  DeploymentDimensions,
  EnvironmentDimensions,
  EnvironmentIdentity,
  IdentityCompleteness,
  IdentityConfidence,
  IdentityChildOptions,
  IdentityDimensions,
  IdentityKind,
  IdentityDimensionsByKind,
  IdentityOptions,
  IdentityRealm,
  IdentityTarget,
  OrganizationDimensions,
  IdentityProvenance,
  IdentitySchemaVersion,
  OrganizationIdentity,
  RuntimeInstanceIdentity,
  RuntimeRealmIdentity,
  RuntimeRealmDimensions,
  RuntimeInstanceDimensions,
  SemanticIdentity,
} from "./identity.js";
export {
  assertEvidenceGraphIntegrity,
  assertEvidenceValue,
  canonicalizeEvidenceValue,
  normalizeEvidenceGraph,
  redactEvidenceValue,
  stableEvidenceId,
} from "./evidence.js";
export { EvidenceIntegrityError, EvidenceResourceError } from "./evidence.js";
export { EvidenceBudgetExceededError, reserveEvidenceBudget } from "./evidence-budget.js";
export {
  assertDriftLedgerEntry,
  compareV1Outputs,
  ParityResourceError,
} from "./evidence-parity.js";
export type {
  DriftClass,
  DriftLedgerEntry,
  ParityComparison,
  ParityDiff,
  ParityLimits,
  ParityValue,
} from "./evidence-parity.js";
export {
  EvidenceProjectionError,
  EvidenceReaderError,
  migrateDoctorReport,
  migrateProjectFacts,
  projectFactsFromEvidence,
  readEvidenceFile,
  readEvidenceDocument,
  reportFromEvaluations,
  reportFromV2Evaluations,
} from "./evidence-reader.js";
export type {
  EvidenceDocumentKind,
  EvidenceDocumentReadResult,
  EvidenceProjectionOptions,
  EvidenceReaderErrorDetails,
  EvidenceReaderFailureCode,
  EvidenceReaderOptions,
} from "./evidence-reader.js";
export { capConfidence, stableEvaluationId, weakestConfidence } from "./rule-contract.js";
export type {
  EvidenceAwareRuleMeta,
  EvidenceRequirement,
  EvidenceSelector,
  RuleApplicability,
  RuleEvaluationIdentity,
  RuleEvaluationResult,
  RuleExecutionState,
  RuleEngineErrorState,
  RuleFailResult,
  RuleNotApplicableResult,
  RuleOwner,
  RulePassResult,
  RuleReasonCode,
  RuleRemediation,
  RuleUnknownResult,
} from "./rule-contract.js";
export { runEvidenceAwareRules } from "./rule-contract.js";
export type {
  EvidenceAwareRule,
  EvidenceRuleContext,
  EvidenceRuleDecision,
  EvidenceRuleRunnerInput,
  EvidenceRuleRunnerOutput,
  EvidenceRuleScope,
  EvidenceQuery,
} from "./rule-contract.js";
export {
  MIGRATED_GROUP1_BRIDGE_SSR_RUNTIME_PLUGIN_RULE_IDS,
  MIGRATED_GROUP1_CONFIG_RULE_IDS,
  MIGRATED_GROUP2_RULE_IDS,
  ruleInventory,
  ruleInventoryIds,
} from "./rule-inventory.js";
export type {
  RuleInventoryEntry,
  RuleMigrationGroup,
  RuleMigrationStatus,
} from "./rule-inventory.js";
export type {
  EvidenceAssertion,
  EvidenceCompleteness,
  EvidenceCompletenessInfo,
  EvidenceConfidence,
  EvidenceConfidenceInfo,
  EvidenceEdge,
  EvidenceEdgeKind,
  EvidenceGraphV2,
  EvidenceIdentity,
  EvidenceLayer,
  EvidenceLimits,
  EvidenceProtocolIdentity,
  EvidenceProtocolVersion,
  EvidenceProvenance,
  EvidenceRuleEvaluation,
  EvidenceScope,
  EvidenceSubject,
  EvidenceSubjectKind,
  EvidenceValue,
  RuleOutcome,
} from "./evidence.js";
