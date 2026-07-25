export { analyze, analyzeFederation } from "./engine.js";
export { resolveOptions, isCiEnvironment, DEFAULT_EXCLUDE, DEFAULT_INCLUDE } from "./config.js";
export {
  DOCTOR_PRESET_NAMES,
  definePolicyPack,
  isDoctorPresetName,
  presets,
  recommendedPreset,
  resolvePolicy,
  strictPreset,
} from "./policy.js";
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
export { defineRule, builtInRules } from "./rules.js";
export { ProbeError, probeManifest } from "./probe.js";
export {
  RuntimeTraceError,
  analyzeRuntime,
  correlateRuntime,
  loadRuntimeTraceFile,
  parseRuntimeTraces,
} from "./runtime-trace.js";
export { buildUiPayload } from "./ui-graph.js";
export type { ManifestProbeResult, ProbeOptions } from "./probe.js";
export type { ApplyBaselineResult, ResolvedBaselineOptions } from "./baseline.js";
export type {
  AnalysisCapabilities,
  AnalysisResult,
  ArtifactFacts,
  BaselineEntry,
  BaselineFile,
  BaselineOptions,
  BundlerFacts,
  BundlerName,
  DependencyFacts,
  DoctorExtendEntry,
  DoctorFinding,
  DoctorOptions,
  DoctorPolicyPack,
  DoctorPresetName,
  DoctorReport,
  DoctorRule,
  DoctorUiPayload,
  FederationAnalysisResult,
  ImportEvidenceSource,
  ImportFacts,
  ModuleFederationConfigLike,
  UnresolvedDynamicApi,
  UnresolvedDynamicImport,
  NormalizedMFConfig,
  OutputFormat,
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
