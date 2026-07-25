export { analyze, analyzeFederation } from "./engine.js";
export { resolveOptions, DEFAULT_EXCLUDE, DEFAULT_INCLUDE } from "./config.js";
export { defineRule, builtInRules } from "./rules.js";
export { ProbeError, probeManifest } from "./probe.js";
export { buildUiPayload } from "./ui-graph.js";
export { htmlReport } from "./html.js";
export { DEFAULT_UI_PORT, serveUi } from "./ui-server.js";
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
  ImportFacts,
  ModuleFederationConfigLike,
  NormalizedMFConfig,
  OutputFormat,
  ProjectFacts,
  ProjectIdentity,
  ResolvedDoctorOptions,
  RuleContext,
  RuleMeta,
  RuleSetting,
  Severity,
  SourceLocation,
  UiGraph,
  UiGraphEdge,
  UiGraphNode,
  UiGraphNodeKind,
} from "./types.js";
