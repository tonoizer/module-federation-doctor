export { analyze, analyzeFederation } from "./engine.js";
export { resolveOptions, DEFAULT_EXCLUDE, DEFAULT_INCLUDE } from "./config.js";
export { defineRule, builtInRules } from "./rules.js";
export { ProbeError, probeManifest } from "./probe.js";
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
} from "./types.js";
