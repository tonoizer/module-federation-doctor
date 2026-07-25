export { analyze, analyzeFederation } from "./engine.js";
export { resolveOptions, isCiEnvironment, DEFAULT_EXCLUDE, DEFAULT_INCLUDE } from "./config.js";
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
export type {
  AnalysisCapabilities,
  AnalysisResult,
  ArtifactFacts,
  BundlerFacts,
  BundlerName,
  DependencyFacts,
  DoctorFinding,
  DoctorOptions,
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
