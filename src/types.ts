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
   * Classification of bundler `output.publicPath` from the compiler (webpack/rspack).
   * Absent when Doctor did not observe compiler output options.
   */
  outputPublicPathKind?: OutputPublicPathKind;
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
  };
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

export interface ArtifactRecord {
  kind: ArtifactKind;
  path: string;
  valid: boolean;
  source: ArtifactSource;
}

export interface ArtifactFacts {
  manifest?: {
    path: string;
    valid: boolean;
    id?: string;
    name?: string;
    publicPath?: string;
    pluginVersion?: string;
    buildVersion?: string;
    remoteEntry?: {
      name: string;
      path: string;
      type?: string;
    };
    types?: {
      path?: string;
      zip?: string;
      api?: string;
    };
    exposes: ManifestExpose[];
    shared: ManifestShared[];
    remotes?: Array<{
      name: string;
      alias?: string;
      entry?: string;
      version?: string;
      shareScope: string[];
    }>;
  };
  stats?: {
    path: string;
    valid: boolean;
  };
  /** Every discovered artifact, kept in deterministic path order. */
  records?: ArtifactRecord[];
  emittedAssets: string[];
  /** Relative path or asset basename → on-disk byte size when resolvable. */
  assetSizes?: Record<string, number>;
}

export interface ProjectFacts {
  schemaVersion: 1;
  project: ProjectIdentity;
  bundler: BundlerFacts;
  capabilities: AnalysisCapabilities;
  moduleFederation?: NormalizedMFConfig;
  dependencies: DependencyFacts;
  imports: ImportFacts;
  artifacts: ArtifactFacts;
}

export interface DoctorFinding {
  schemaVersion: 1;
  ruleId: string;
  severity: Severity;
  message: string;
  project: string;
  location?: SourceLocation;
  evidence: Record<string, unknown>;
  suggestion?: string;
  documentation?: string;
  fingerprint: string;
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
   * Resolved shared-usage governance (package lists + import depth).
   * Present for project analysis; absent for hand-built federation fixtures
   * that only exercise `analyzeFederation`.
   */
  sharedPolicy?: Readonly<ResolvedDoctorOptions["sharedPolicy"]>;
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

/** Built-in named severity presets (`recommended` / `strict`). */
export type DoctorPresetName = "recommended" | "strict";

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

export interface DoctorOptions {
  moduleFederation?: ModuleFederationConfigLike;
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
  mode?: "development" | "ci";
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
}

export interface ResolvedDoctorOptions {
  moduleFederation?: ModuleFederationConfigLike;
  bundler: BundlerName;
  bundlerVersion?: string;
  artifactNames: {
    manifest: string[];
    stats: string[];
  };
  viteLifecycle?: ViteLifecycleFacts;
  mode: "development" | "ci";
  root: string;
  runtimeTrace?: string;
  output: {
    directory: string;
    formats: OutputFormat[];
  };
  failOn: "never" | "warning" | "error";
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
}

export interface RuntimeTraceReport {
  schemaVersion: 1;
  traceId?: string;
  status?: string;
  errorCode?: string;
  outcome?: string;
  remote?: {
    name?: string;
    alias?: string;
    entry?: string;
  };
  shared?: {
    package?: string;
    provider?: string;
    requiredVersion?: string;
    selectedVersion?: string;
    availableVersions?: string[];
    reason?: string;
  };
  moduleInfo?: {
    name?: string;
    id?: string;
    publicPath?: string;
  };
  phases?: Record<string, { status?: string }>;
  events: Array<{
    phase?: string;
    status?: string;
    errorCode?: string;
  }>;
  diagnosis?: {
    owner?: string;
    summary?: string;
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
  };
  findings: DoctorFinding[];
}

export interface AnalysisResult {
  facts: ProjectFacts;
  report: DoctorReport;
  exitCode: 0 | 1 | 2;
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
  exitCode: 0 | 1;
}
