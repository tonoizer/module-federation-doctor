import type {
  AnalysisBudgetOptions,
  AnalysisBudgetReport,
  AnalysisBudgets,
} from "./analysis-budgets.js";
import type { CanonicalMFConfigV1 } from "./canonical-config.js";
import type { AnalysisContentCache } from "./analysis-cache.js";
import type { ParityComparison } from "./evidence-parity.js";
import type { EvidenceRolloutController, RolloutMode } from "./evidence-rollout.js";
import type { RuleEvaluationResult, RuleExecutionState } from "./rule-contract.js";

export type BundlerName = "vite" | "rspack" | "rsbuild" | "webpack" | "modern" | "unknown";
export type Severity = "info" | "warning" | "error";
export type OutputFormat = "terminal" | "json" | "sarif";
export type RuleSetting = "off" | Severity | readonly [Severity, Record<string, unknown>];

/** Vite-family emit engine (classic Rollup vs Rolldown). */
export type ViteLifecycleEngine = "rollup" | "rolldown";

/**
 * Supported Vite-family MF entry flavors. All use
 * `@module-federation/doctor/vite` + `@module-federation/vite`.
 */
export type ViteLifecycleFlavor = "vite" | "rolldown-vite" | "vite-plus";

/** Recorded when the Vite adapter analyzes a Vite / Rolldown / Vite Plus build. */
export interface ViteLifecycleFacts {
  flavor: ViteLifecycleFlavor;
  engine: ViteLifecycleEngine;
  /** Post-emit hook that produced analysis facts, when known. */
  postEmitHook?: "writeBundle" | "closeBundle";
  /** Declared/installed packages or public hook meta that drove detection. */
  evidence: string[];
}

export interface SourceLocation {
  path: string;
  line?: number;
  column?: number;
}

export interface ProjectIdentity {
  name: string;
  root: string;
  /** Stable workspace identity. Optional for legacy project.json files. */
  identityKey?: string;
  /** Explicit federation analysis group. Projects in different groups are not compared. */
  federationGroup?: string;
}

/** How the bundler `output.publicPath` was typed when Doctor observed the compiler. */
export type OutputPublicPathKind = "string" | "non-string" | "auto" | "unknown";

export interface BundlerFacts {
  name: BundlerName;
  version?: string;
  mode: string;
  /** Present for Vite-family adapters when the emit lifecycle is known. */
  lifecycle?: ViteLifecycleFacts;
  /**
   * Count of Module Federation plugins on the compiler (webpack/rspack adapters).
   * Absent when Doctor did not observe the compiler plugin list (CLI-only runs).
   */
  moduleFederationPluginCount?: number;
  /**
   * Stable registration identities when the adapter could read each plugin's
   * public configuration. When absent, only the legacy aggregate count is
   * known and duplicate registration remains conservative.
   */
  federationInstances?: FederationInstanceRef[];
  /**
   * Classification of bundler `output.publicPath` from the compiler (webpack/rspack).
   * Absent when Doctor did not observe compiler output options.
   */
  outputPublicPathKind?: OutputPublicPathKind;
  /**
   * Additive Vite resolved-config snapshot from `configResolved` (plugin path).
   * Absent on CLI-only runs — rules that need these facts skip honestly.
   */
  viteConfig?: ViteBundlerConfigFacts;
  /**
   * Library names from `transformImport` / equivalent rewrite plugins when known.
   * Absent means unknown (honest skip for conflict rules).
   */
  transformImportLibraries?: string[];
}

/** Static Vite config slices collected for dialect rules (never invent when missing). */
export interface ViteBundlerConfigFacts {
  /** True when user `build.rollupOptions.output` / `build.rolldownOptions.output.manualChunks` is configured. */
  manualChunks?: boolean;
  /** True when Rolldown/Vite Plus `codeSplitting.groups` is configured. */
  codeSplittingGroups?: boolean;
  /** Static string `resolve.alias` entries only (object form; function aliases skipped). */
  resolveAliases?: Record<string, string>;
  /**
   * `server.origin` when the adapter observed Vite `server` config.
   * `null` means observed but unset/empty; omit the field when not observed (CLI).
   */
  serverOrigin?: string | null;
  /** Resolved Vite dev-server port when the adapter observed it. */
  serverPort?: number;
}

export interface AnalysisCapabilities {
  config: boolean;
  sourceImports: boolean;
  manifest: boolean;
  stats: boolean;
  emittedAssets: boolean;
  installedVersions: boolean;
}

export interface NormalizedRemote {
  name: string;
  entry: string;
  alias?: string;
  type?: string;
  version?: string;
  entryGlobalName?: string;
  shareScope: string | string[];
}

export interface NormalizedShared {
  package: string;
  singleton: boolean;
  eager: boolean;
  strictVersion?: boolean;
  requiredVersion?: string | false;
  version?: string | false;
  import?: string | false;
  shareKey?: string;
  request?: string;
  allowNodeModulesSuffixMatch?: boolean;
  shareScope: string | string[];
  treeShaking?: {
    mode?: "server-calc" | "runtime-infer";
    usedExports?: string[];
  };
}

export interface NormalizedToggle {
  enabled: boolean;
  options: Record<string, unknown>;
}

export interface NormalizedMFConfig {
  name?: string;
  filename?: string;
  library?: { type?: string; name?: unknown };
  remoteType?: string;
  shareScope?: string[];
  exposes: Record<string, string>;
  remotes: Record<string, NormalizedRemote>;
  shared: Record<string, NormalizedShared>;
  runtimePlugins?: string[];
  getPublicPath?: string;
  implementation?: string;
  manifest?: NormalizedToggle;
  dev?: NormalizedToggle;
  dts?: NormalizedToggle;
  shareStrategy?: "version-first" | "loaded-first";
  virtualRuntimeEntry?: boolean;
  experiments?: {
    asyncStartup: boolean;
    externalRuntime: boolean;
    provideExternalRuntime: boolean;
    disableSnapshot?: boolean;
    disableRemote?: boolean;
    disableShared?: boolean;
    target?: "web" | "node";
  };
  treeShaking?: {
    injectUsedExports?: boolean;
    directory?: string;
    plugins: string[];
    excludePlugins: string[];
  };
  vite?: {
    publicPath?: string;
    bundleAllCSS: boolean;
    ignoreOrigin: boolean;
    virtualModuleDir?: string;
    hostInitInjectLocation?: "entry" | "html";
    moduleParseTimeout?: number;
    moduleParseIdleTimeout?: number;
    varFilename?: string;
    target?: "web" | "node";
    disableRemote?: boolean;
    disableShared?: boolean;
    disableSnapshot?: boolean;
    ssrExternals: string[];
    ssrEntryLoader?: string;
    remoteHmr?: boolean;
  };
  /** Bridge plugin options (`enableBridgeRouter`, etc.). Preserved from raw MF config. */
  bridge?: {
    enableBridgeRouter?: boolean;
    [key: string]: unknown;
  };
}

/** Stable compiler-registration identity for one Module Federation plugin. */
export interface FederationInstanceRef {
  id: string;
  pluginName: string;
  /** SHA-256 digest of the canonical declared plugin configuration. */
  configDigest: string;
  /** Shared identity for registrations with the same plugin/config pair. */
  registrationGroup: string;
}

export interface DependencyFacts {
  declared: Record<string, string>;
  installed: Record<string, string>;
}

/** How a resolved import/specifier entered project facts. */
export type ImportEvidenceSource = "source" | "manifest" | "runtime-trace";

/** Dynamic/runtime call sites Doctor could not resolve to a string specifier. */
export type UnresolvedDynamicApi =
  | "import"
  | "loadRemote"
  | "loadShare"
  | "loadShareSync"
  | "registerRemotes";

export interface UnresolvedDynamicImport {
  api: UnresolvedDynamicApi;
  /** Workspace-relative source file when known. */
  file: string;
}

/** How far the import collector walks local modules (MFDOCTOR-122). */
export type ImportDepth = "direct" | "local-graph";
/** Attribution confidence for source-derived evidence in a facts snapshot. */
export type ImportSourceScope = "project" | "instance" | "partial";

export interface ImportFacts {
  sourceFiles: string[];
  specifiers: string[];
  /**
   * Resolved package names from static imports, dynamic `import()` /
   * `require()` / `loadShare*` string literals, and opt-in runtime traces.
   * Configured remote aliases are excluded (see `remotes`).
   */
  packages: string[];
  /** Packages seen only through dynamic `import()` / `loadShare*` literals or runtime traces. */
  dynamicPackages: string[];
  /**
   * Remote aliases referenced by `import('alias/...')` / `loadRemote('alias/...')`
   * literals, plus remotes hinted by manifest or opt-in runtime traces.
   */
  remotes: string[];
  /**
   * Dynamic call sites that could not be resolved statically.
   * Prefer `doctor/partial-analysis` over claiming unused/missing usage.
   */
  unresolvedDynamic: UnresolvedDynamicImport[];
  /** Workspace-relative source files that could not be read during collection. */
  sourceReadFailures?: string[];
  /** Whether source-derived fields are project-wide, instance-scoped, or conservative partial evidence. */
  sourceScope?: ImportSourceScope;
  /** Evidence channels that contributed to packages/remotes. */
  evidenceSources: ImportEvidenceSource[];
  /**
   * Collector depth used for this facts snapshot.
   * `direct` counts import/require/dynamic only; `local-graph` also counts
   * `export … from` package re-exports (default).
   */
  depth?: ImportDepth;
  /**
   * Package subpath specifiers observed (e.g. `lodash/cloneDeep`).
   * Used by `shared/deep-import-bypass`.
   */
  deepImports?: string[];
  /**
   * Workspace-relative files that contain at least one deep import of a root package.
   * Keys are package names (`lodash`), values are file paths.
   */
  deepImportFiles?: Record<string, string[]>;
}

export interface ManifestExpose {
  key: string;
  assets: string[];
}

export interface ManifestShared {
  name: string;
  version?: string;
  requiredVersion?: string;
  singleton?: boolean;
  assets: string[];
}

export type ArtifactKind = "manifest" | "stats";
export type ArtifactSource = "discovered" | "emitted";
export type ArtifactState = "valid" | "malformed";
export type BuildCapabilityState = "exact" | "partial" | "unavailable" | "not-applicable";

export interface BuildCapability {
  state: BuildCapabilityState;
  reason: string;
  source?: string;
}

interface ArtifactRecordBase {
  kind: ArtifactKind;
  path: string;
  valid: boolean;
  source: ArtifactSource;
  state: ArtifactState;
  /** Stable run-local build link when the artifact came from a build hook. */
  buildId?: string;
  configuredName?: string;
  /** Instance attribution when an emitted artifact can be matched exactly. */
  federationInstanceId?: string;
}

export type ArtifactManifestRecord = ArtifactRecordBase & {
  kind: "manifest";
  manifest: ArtifactManifest;
  stats?: never;
};

export type ArtifactStatsRecord = ArtifactRecordBase & {
  kind: "stats";
  manifest?: never;
  stats: ArtifactStats;
};

export type ArtifactRecord = ArtifactManifestRecord | ArtifactStatsRecord;

export interface ArtifactManifest {
  path: string;
  valid: boolean;
  id?: string;
  name?: string;
  publicPath?: string;
  pluginVersion?: string;
  buildVersion?: string;
  remoteEntry?: { name: string; path: string; type?: string };
  types?: { path?: string; zip?: string; api?: string };
  exposes: ManifestExpose[];
  shared: ManifestShared[];
  remotes?: Array<{
    name: string;
    alias?: string;
    entry?: string;
    version?: string;
    shareScope: string[];
  }>;
}

export interface ArtifactStats {
  path: string;
  valid: boolean;
  data?: Record<string, unknown>;
}

export interface ArtifactFacts {
  manifest?: ArtifactManifest;
  stats?: ArtifactStats;
  /** Every discovered artifact, kept in deterministic path order. */
  records?: ArtifactRecord[];
  emittedAssets: string[];
  /** Relative path or asset basename → on-disk byte size when resolvable. */
  assetSizes?: Record<string, number>;
}

export interface BuildRecord {
  id: string;
  adapter: BundlerName;
  bundler: BundlerName;
  /** Public compiler identity when the adapter exposes one. */
  compilerName?: string;
  /** Public compilation identity when the adapter exposes one. */
  compilationName?: string;
  /** Public compilation hash when the adapter exposes one. */
  hash?: string;
  flavor?: ViteLifecycleFlavor;
  engine?: ViteLifecycleEngine;
  /** Safe project-relative output root. */
  outputRoot?: string;
  /** Federation instance scopes represented by this compiler output. */
  federationInstanceIds?: string[];
  emittedAssets: string[];
  artifacts: ArtifactRecord[];
  effectiveMode?: string;
  target?: string;
  targetKind?: "web" | "node" | "ssr" | "worker" | "unknown";
  modernContext?: ModernContextFacts;
  capabilities: {
    outputRoot: BuildCapability;
    emittedAssets: BuildCapability;
    artifacts: BuildCapability;
    effectiveMode: BuildCapability;
    target: BuildCapability;
  };
  /** Public hook that finalized this output record (adapter-specific). */
  sourceHook: string;
}

/**
 * Adapter-agnostic per-output input for collector normalization.
 * Vite fills this from public hooks; other adapters can reuse the same seam.
 */
export interface BuildOutputInput {
  adapter: BundlerName;
  bundler: BundlerName;
  compilerName?: string;
  compilationName?: string;
  hash?: string;
  outputRoot?: string;
  /** Optional adapter-provided instance scopes for this output. */
  federationInstanceIds?: string[];
  /** Asset names relative to `outputRoot` when that root is known. */
  emittedAssets: string[];
  /**
   * How asset names were learned. `bundle` is exact compiler evidence;
   * `output-root-scan` is a bounded disk recovery (partial).
   */
  emittedAssetsSource?: "bundle" | "output-root-scan";
  /** A framework adapter may prove that a bounded scan is complete. */
  emittedAssetsComplete?: boolean;
  sourceHook: string;
  effectiveMode?: string;
  target?: string;
  targetKind?: BuildRecord["targetKind"];
  modernContext?: ModernContextFacts;
  flavor?: ViteLifecycleFlavor;
  engine?: ViteLifecycleEngine;
  buildWrite?: boolean;
}

/** Public Modern.js context and bundler-chain utility evidence for one build. */
export interface ModernContextFacts {
  packageName?: string;
  command?: string;
  metaName?: string;
  bundlerType?: string;
  isProd?: boolean;
  env?: string;
  target?: string;
}

/** @deprecated Use {@link BuildOutputInput}. Kept as an alias for the Vite slice. */
export type ViteBuildOutputInput = BuildOutputInput;

export type RuntimePluginContractFinding =
  | {
      plugin: string;
      kind: "invalid-factory";
      reason: "no-export" | "non-factory-export" | "missing-name";
      file?: string;
    }
  | {
      plugin: string;
      kind: "cors-parity";
      reason: "create-script-without-create-link" | "cors-mismatch";
      confidence: "clear" | "heuristic";
      file?: string;
    };

export interface ProjectFacts {
  schemaVersion: 1;
  project: ProjectIdentity;
  bundler: BundlerFacts;
  capabilities: AnalysisCapabilities;
  moduleFederation?: NormalizedMFConfig;
  /**
   * Instance-scoped facts. The legacy top-level fields remain the deterministic
   * first-instance compatibility projection for v1 consumers.
   */
  federationInstances?: FederationInstanceFacts[];
  /** Active scope used while evaluating instance-aware rules; not persisted. */
  federationInstanceId?: string;
  /** In-memory declared config bridge; omitted from legacy persisted v1 facts. */
  canonicalConfig?: CanonicalMFConfigV1;
  dependencies: DependencyFacts;
  imports: ImportFacts;
  /** Static runtimePlugins contract probes; absent/empty when none apply. */
  runtimePluginContracts?: RuntimePluginContractFinding[];
  artifacts: ArtifactFacts;
  /** Optional source-analysis completeness metadata persisted by current reporters. */
  analysis?: AnalysisBudgetReport;
  /** Exact per-output records. Legacy artifact fields remain the compatibility view. */
  builds?: BuildRecord[];
}

export interface DoctorFinding {
  schemaVersion: 1;
  ruleId: string;
  severity: Severity;
  message: string;
  project: string;
  /** Identifies the affected federation instance when the finding is scoped. */
  federationInstanceId?: string;
  location?: SourceLocation;
  evidence: Record<string, unknown>;
  suggestion?: string;
  documentation?: string;
  fingerprint: string;
  /**
   * Optional versioned details schema id (e.g. `shared.unused.v1`).
   * Top-level only — never put this in `evidence` (fingerprints hash evidence).
   */
  detailsSchema?: string;
  /**
   * Optional machine-readable payload for `detailsSchema`.
   * Not an input to `fingerprint()`; baselines/SARIF stay stable when this is added.
   */
  details?: Record<string, unknown>;
  /** Present when the finding matches a checked-in fingerprint baseline entry. */
  suppressed?: boolean;
  /** Optional human reason copied from the matching baseline entry. */
  suppressionReason?: string;
}

export interface RuleMeta {
  id: string;
  defaultSeverity: Severity;
  supportedBundlers: BundlerName[];
  documentation: string;
  category?: "correctness" | "performance" | "reliability" | "security" | "tooling";
  impact?: string;
  fix?: string;
  sources?: string[];
}

export interface RuleContext {
  facts: Readonly<ProjectFacts>;
  options: Readonly<Record<string, unknown>>;
  /**
   * Absolute project root for disk reads. `facts.project.root` stays a portable
   * relative marker (`"."`); rules that open source files should prefer this.
   */
  root?: string;
  /**
   * Resolved shared-usage governance (package lists + import depth).
   * Present for project analysis; absent for hand-built federation fixtures
   * that only exercise `analyzeFederation`.
   */
  sharedPolicy?: Readonly<ResolvedDoctorOptions["sharedPolicy"]>;
  /**
   * Soft-recognize mf-toolkit bridge / fragment / shared-inspector shapes.
   * Default when unset: enabled only when toolkit signals are present on facts.
   * Per-rule `options.recognizeMfToolkit` overrides this value.
   */
  recognizeMfToolkit?: boolean;
  report(
    finding: Omit<
      DoctorFinding,
      "schemaVersion" | "ruleId" | "severity" | "project" | "fingerprint"
    >,
  ): void;
}

export interface DoctorRule {
  meta: RuleMeta;
  check(context: RuleContext): void | DoctorFinding[] | Promise<void | DoctorFinding[]>;
}

export interface ModuleFederationConfigLike {
  name?: string;
  filename?: string;
  library?: { type?: string; name?: unknown };
  remoteType?: string;
  shareScope?: string | string[];
  exposes?: Record<string, string | { import: string | string[] }>;
  remotes?: Record<
    string,
    | string
    | {
        alias?: string;
        name?: string;
        entry?: string;
        external?: string | string[];
        type?: string;
        version?: string;
        entryGlobalName?: string;
        shareScope?: string | string[];
      }
  >;
  shared?:
    | string[]
    | Record<
        string,
        | string
        | {
            singleton?: boolean;
            eager?: boolean;
            strictVersion?: boolean;
            requiredVersion?: string | false;
            version?: string | false;
            import?: string | false;
            shareKey?: string;
            request?: string;
            allowNodeModulesSuffixMatch?: boolean;
            shareScope?: string | string[];
            treeShaking?:
              | boolean
              | {
                  mode?: "server-calc" | "runtime-infer";
                  usedExports?: string[];
                };
          }
      >;
  runtimePlugins?: Array<string | [string, Record<string, unknown>]>;
  getPublicPath?: string;
  implementation?: string;
  manifest?: boolean | Record<string, unknown>;
  dev?: boolean | Record<string, unknown>;
  dts?: boolean | Record<string, unknown>;
  shareStrategy?: "version-first" | "loaded-first";
  virtualRuntimeEntry?: boolean;
  experiments?: {
    asyncStartup?: boolean;
    externalRuntime?: boolean;
    provideExternalRuntime?: boolean;
    optimization?: {
      disableSnapshot?: boolean;
      disableRemote?: boolean;
      disableShared?: boolean;
      target?: "web" | "node";
    };
  };
  injectTreeShakingUsedExports?: boolean;
  treeShakingDir?: string;
  treeShakingSharedPlugins?: string[];
  treeShakingSharedExcludePlugins?: string[];
  publicPath?: string;
  bundleAllCSS?: boolean;
  ignoreOrigin?: boolean;
  virtualModuleDir?: string;
  hostInitInjectLocation?: "entry" | "html";
  moduleParseTimeout?: number;
  moduleParseIdleTimeout?: number;
  varFilename?: string;
  target?: "web" | "node";
  disableRemote?: boolean;
  disableShared?: boolean;
  disableSnapshot?: boolean;
  ssrExternals?: string[];
  ssrEntryLoader?: string;
  remoteHmr?: boolean;
  /** Bridge plugin options (`enableBridgeRouter`, deprecated flags, …). */
  bridge?: {
    enableBridgeRouter?: boolean;
    [key: string]: unknown;
  };
}

/** Explicit adapter/config input for one independently analyzed MF instance. */
export interface ModuleFederationInstanceInput {
  config: ModuleFederationConfigLike;
  pluginName?: string;
}

export interface FederationInstanceFacts {
  id: string;
  pluginName: string;
  configDigest: string;
  registrationGroup: string;
  moduleFederation: NormalizedMFConfig;
  capabilities: AnalysisCapabilities;
  /** In-memory lossless declared view for this instance. */
  canonicalConfig?: CanonicalMFConfigV1;
  imports: ImportFacts;
  runtimePluginContracts?: RuntimePluginContractFinding[];
  artifacts: ArtifactFacts;
  builds?: BuildRecord[];
}

export interface BaselineEntry {
  fingerprint: string;
  ruleId?: string;
  project?: string;
  reason?: string;
}

export interface BaselineFile {
  schemaVersion: 1;
  entries: BaselineEntry[];
}

export interface BaselineOptions {
  /** Path to a checked-in baseline JSON file (relative to `root` or absolute). */
  path: string;
  /**
   * When true, suppressed findings still fail `failOn` policy.
   * Default false: suppressed findings appear in reports but do not fail the gate.
   */
  failOnSuppressed?: boolean;
  /**
   * When true (default), emit `doctor/stale-baseline` info findings for unused
   * baseline entries.
   */
  reportStale?: boolean;
}

/** Built-in named severity presets and recommendation profile overlays. */
export type DoctorPresetName = "recommended" | "strict" | "demo" | "production";

/** Explicit environment profile shortcut for recommendation policy overlays. */
export type DoctorProfile = "demo" | "production";

/**
 * Shared-dependency governance knobs for packs and local config (MFDOCTOR-122).
 * Lists extend built-in defaults; they do not replace them.
 */
export interface DoctorSharedPolicy {
  /** Import scan depth. Default `local-graph`. */
  importDepth?: ImportDepth;
  /** Extra packages treated as share candidates. */
  additionalCandidates?: string[];
  /** Extra packages that should be singleton when shared. */
  additionalSingletonRisks?: string[];
  /** Packages never flagged as unused / host-gap / ghost by default. */
  alwaysShared?: string[];
  /** Deep-import specifiers to ignore (extends the JSX runtime allowlist). */
  deepImportAllowlist?: string[];
}

/**
 * Shareable policy pack: severity map plus optional custom rules (`defineRule`).
 * Publish as a package default export or load via a relative config path.
 */
export interface DoctorPolicyPack {
  name?: string;
  rules?: Record<string, RuleSetting>;
  plugins?: DoctorRule[];
  /** Package lists / import depth for shared-usage governance. */
  sharedPolicy?: DoctorSharedPolicy;
}

/**
 * `extends` entry: built-in preset name, inline/imported pack, custom rule, or
 * a package/path string that resolves to one of those (no remote HTTP).
 */
export type DoctorExtendEntry = DoctorPresetName | DoctorPolicyPack | DoctorRule | (string & {});

/**
 * Terminal print toggles (RS Doctor–style). Findings always print when the
 * terminal format is enabled; success chatter is off by default.
 */
export interface DoctorPrintLog {
  /**
   * When true, print the green "no findings" line on a clean run.
   * Default false — quiet success.
   */
  success?: boolean;
}

export type HealthScoreLabel = "Great" | "OK" | "Needs work";

export interface DoctorOptions {
  analysisBudgets?: AnalysisBudgetOptions;
  /** @internal Evidence rollout injection for staged rule migration; no CLI equivalent. */
  evidenceRollout?: EvidenceRolloutController;
  /** Optional bounded parsed-input cache explicitly shared by one process. */
  analysisCache?: AnalysisContentCache;
  moduleFederation?: ModuleFederationConfigLike;
  /** Multiple independently configured MF plugins in one compiler/config. */
  moduleFederationInstances?: Array<ModuleFederationInstanceInput | ModuleFederationConfigLike>;
  /** Explicit workspace scope for federation-wide comparisons. */
  federationGroup?: string;
  bundler?: BundlerName;
  bundlerVersion?: string;
  /** Optional public artifact names used to bound post-build discovery. */
  artifactNames?: {
    manifest?: string[];
    stats?: string[];
  };
  /**
   * Vite-family lifecycle override. Adapters normally detect this from
   * package.json / public plugin meta; set only in tests or unusual setups.
   */
  viteLifecycle?: ViteLifecycleFacts;
  /**
   * Additive Vite resolved-config facts from the adapter `configResolved` hook.
   * Not available on CLI-only runs.
   */
  viteConfigFacts?: ViteBundlerConfigFacts;
  /**
   * Library names from bundler/framework `transformImport` (Modern/Rsbuild).
   * Omit when unknown — rules skip rather than inventing rewrite lists.
   */
  transformImport?: Array<string | { libraryName: string }>;
  mode?: "development" | "ci";
  /**
   * Apply the built-in environment overlay after `extends` and before local
   * `rules`. In CI, `profile: "demo"` resolves to the production overlay.
   */
  profile?: DoctorProfile;
  root?: string;
  /** Default Observability export path for `mfdoctor runtime` when no trace arg is given.
   * When set on `check` / adapter options, also merges shared/remote hints into import facts. */
  runtimeTrace?: string;
  output?: {
    directory?: string;
    formats?: OutputFormat[];
  };
  failOn?: "never" | "warning" | "error";
  /**
   * When false, omit the health score footer from terminal output.
   * Report JSON still includes `summary.score` / `summary.scoreLabel`.
   * CLI: `--no-score`.
   */
  score?: boolean;
  /**
   * When false, omit top-N agent prompts from terminal output.
   * CLI: `--no-prompt`. Default on for human terminal.
   */
  prompt?: boolean;
  /**
   * Optional directory for bounded agent diagnostics dump
   * (`report.json`, `prompts/*.md`, `summary.md`). Must stay inside the project root.
   * CLI: `--diagnostics-dir`.
   */
  diagnosticsDir?: string;
  /**
   * When true (default), skip terminal output on zero findings.
   * Override with `printLog.success: true`, `quiet: false`, CLI `--verbose`,
   * or `MFDOCTOR_QUIET=0`. Force quiet with `MFDOCTOR_QUIET=1`.
   */
  quiet?: boolean;
  /** Fine-grained terminal print toggles. `printLog.success` implies not quiet. */
  printLog?: DoctorPrintLog;
  /**
   * Fingerprint baseline for incremental CI adoption.
   * Pass a path string or `{ path, failOnSuppressed?, reportStale? }`.
   */
  baseline?: string | BaselineOptions;
  include?: string[];
  exclude?: string[];
  /**
   * Local severity / option overrides. Wins over pack and preset maps.
   * CLI flag merges into DoctorOptions before resolve, so flags win over file config.
   */
  rules?: Record<string, RuleSetting>;
  /**
   * Policy layers to apply left → right: preset names, shareable packs, and/or
   * `defineRule` custom rules. Later entries override earlier severity maps.
   */
  extends?: DoctorExtendEntry | DoctorExtendEntry[];
  /** Import scan depth. Default `local-graph` (pack knobs merge underneath). */
  importDepth?: ImportDepth;
  /** Extra packages treated as share candidates (extends built-in list). */
  additionalCandidates?: string[];
  /** Extra packages that should be singleton when shared. */
  additionalSingletonRisks?: string[];
  /** Packages never flagged as unused / host-gap / ghost. */
  alwaysShared?: string[];
  /** Deep-import specifiers to ignore (extends JSX runtime allowlist). */
  deepImportAllowlist?: string[];
  /**
   * Soft-recognize mf-toolkit shapes (mf-bridge `./entry`, mf-ssr fragment URLs,
   * shared-inspector MF2 shared arrays). When unset, recognition applies only if
   * toolkit signals are present. Set `false` to force classic behavior.
   */
  recognizeMfToolkit?: boolean;
}

export interface ResolvedDoctorOptions {
  analysisBudgets: AnalysisBudgets;
  /** Optional bounded parsed-input cache explicitly shared by one process. */
  analysisCache?: AnalysisContentCache;
  moduleFederation?: ModuleFederationConfigLike;
  moduleFederationInstances?: ModuleFederationInstanceInput[];
  /** Explicit workspace scope for federation-wide comparisons. */
  federationGroup?: string;
  bundler: BundlerName;
  bundlerVersion?: string;
  artifactNames: {
    manifest: string[];
    stats: string[];
  };
  viteLifecycle?: ViteLifecycleFacts;
  viteConfigFacts?: ViteBundlerConfigFacts;
  /** Normalized transformImport library names when provided by adapters/options. */
  transformImportLibraries?: string[];
  mode: "development" | "ci";
  root: string;
  runtimeTrace?: string;
  output: {
    directory: string;
    formats: OutputFormat[];
  };
  failOn: "never" | "warning" | "error";
  /**
   * When false, omit the health score footer from terminal output.
   * Defaults to true.
   */
  score: boolean;
  /**
   * When false, omit top-N agent prompts from terminal output.
   * Defaults to true.
   */
  prompt: boolean;
  /** Absolute path for optional diagnostics dump, when configured. */
  diagnosticsDir?: string;
  /** Resolved quiet-success gate for the terminal reporter. */
  quiet: boolean;
  printLog: Required<DoctorPrintLog>;
  baseline?: {
    path: string;
    failOnSuppressed: boolean;
    reportStale: boolean;
  };
  include: string[];
  exclude: string[];
  rules: Record<string, RuleSetting>;
  /** Custom rules contributed by packs and direct `extends` rule entries. */
  extends: DoctorRule[];
  /** Preset / pack labels applied while resolving `extends`. */
  appliedPolicies: string[];
  /** Resolved shared-usage governance (package lists + import depth). */
  sharedPolicy: {
    importDepth: ImportDepth;
    alwaysShared: string[];
    singletonRisks: string[];
    shareCandidates: string[];
    deepImportAllowlist: string[];
  };
  /**
   * Soft-recognize mf-toolkit shapes. Undefined means “auto when signals present”.
   */
  recognizeMfToolkit?: boolean;
}

export interface RuntimeTraceReport {
  schemaVersion: 1;
  /** Source adapter marker. This is not the MF runtime version. */
  sourceContract?: "upstream-observability-2.5.3" | "legacy-doctor-v1" | "partial";
  /**
   * Shared-section completeness. Absence on old/missing/preview Chrome DevTools
   * runtimes is `unknown`, never an implied healthy shared graph.
   */
  sharedCompleteness?: "complete" | "partial" | "unknown";
  evidenceClipped?: boolean;
  traceId?: string;
  status?: string;
  requestId?: string;
  requestAlias?: string;
  hostName?: string;
  runtimeVersion?: string;
  errorCode?: string;
  errorName?: string;
  errorMessage?: string;
  retryable?: boolean;
  errorContext?: Record<string, unknown>;
  failedPhase?: string;
  ownerHint?: string;
  ownerHints?: string[];
  ownerHintConflict?: boolean;
  outcome?: string;
  recovered?: boolean;
  loadedBefore?:
    | boolean
    | {
        producer?: boolean;
        expose?: boolean;
        consumers?: Array<{
          name?: string;
          remoteEntryExports?: boolean;
          containerInitialized?: boolean;
          exposes?: string[];
        }>;
      };
  flags?: Record<string, boolean>;
  loadCompleted?: boolean;
  runtimeLoaded?: boolean;
  sharedResolved?: boolean;
  preloaded?: boolean;
  componentLoaded?: boolean;
  lastPhase?: string;
  remote?: {
    name?: string;
    alias?: string;
    entry?: string;
  };
  shared?: {
    package?: string;
    provider?: string;
    requiredVersion?: string | false;
    selectedVersion?: string;
    availableVersions?: string[];
    reason?: string;
  };
  moduleInfo?: {
    name?: string;
    id?: string;
    publicPath?: string;
    reason?: string;
    clipped?: boolean;
    totalCount?: number;
    matchedCount?: number;
    availableNames?: string[];
    entries?: Array<{
      name?: string;
      publicPath?: string;
      getPublicPath?: string;
      remoteEntry?: string;
      globalName?: string;
    }>;
  };
  phases?: Record<string, { status?: string }>;
  events: Array<{
    phase?: string;
    status?: string;
    errorCode?: string;
    retryable?: boolean;
  }>;
  diagnosis?: {
    owner?: string;
    ownerHint?: string;
    title?: string;
    outcome?: string;
    status?: string;
    errorCode?: string;
    failedPhase?: string;
    errorName?: string;
    errorMessage?: string;
    docLink?: string;
    summary?: string;
    facts?: Record<string, unknown>;
    actions?: Array<Record<string, unknown>>;
    warnings?: string[];
    completedPhases?: string[];
    pendingPhases?: string[];
  };
}

export interface RuntimeAnalysisResult {
  traces: RuntimeTraceReport[];
  projects: ProjectFacts[];
  findings: DoctorFinding[];
  report: DoctorReport;
  ui: DoctorUiPayload;
  summary: {
    schemaVersion: 1;
    traces: number;
    projects: number;
    findings: number;
  };
  exitCode: 0 | 1;
}

export interface DoctorReport {
  schemaVersion: 1;
  capabilities: AnalysisCapabilities;
  summary: {
    projects: number;
    info: number;
    warnings: number;
    errors: number;
    /** Count of findings marked suppressed by a fingerprint baseline. */
    suppressed?: number;
    /**
     * Offline unique-rule health score in `[0, 100]`, or `null` when analysis
     * is too partial (`doctor/partial-analysis`).
     */
    score?: number | null;
    /** Band label for `score`, or `null` when `score` is `null`. */
    scoreLabel?: HealthScoreLabel | null;
  };
  findings: DoctorFinding[];
}

export interface EvidenceAnalysisMetadata {
  rollout: { scope: "rules"; mode: RolloutMode };
  evaluations: RuleEvaluationResult[];
  execution: RuleExecutionState[];
  parity?: ParityComparison;
}

export interface AnalysisResult {
  facts: ProjectFacts;
  report: DoctorReport;
  exitCode: 0 | 1 | 2;
  /** Additive v2/debug metadata; never written into the V1 report contract. */
  evidence?: EvidenceAnalysisMetadata;
}

export type UiGraphNodeKind = "project" | "remote" | "shared" | "expose" | "runtime";

export interface UiGraphNode {
  id: string;
  label: string;
  kind: UiGraphNodeKind;
  project?: string;
  severity?: Severity;
  meta?: Record<string, unknown>;
}

export interface UiGraphEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  severity?: Severity;
}

export interface UiGraph {
  nodes: UiGraphNode[];
  edges: UiGraphEdge[];
}

export interface DoctorUiPayload {
  schemaVersion: 1;
  report: DoctorReport;
  projects: ProjectFacts[];
  graphs: {
    remotes: UiGraph;
    shared: UiGraph;
    orchestration: UiGraph;
  };
}

export interface FederationAnalysisResult {
  projects: ProjectFacts[];
  findings: DoctorFinding[];
  report: DoctorReport;
  ui: DoctorUiPayload;
  exitCode: 0 | 1 | 2;
}
