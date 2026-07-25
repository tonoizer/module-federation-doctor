export type BundlerName = "vite" | "rspack" | "rsbuild" | "unknown";
export type Severity = "info" | "warning" | "error";
export type OutputFormat = "terminal" | "json" | "sarif";
export type RuleSetting = "off" | Severity | readonly [Severity, Record<string, unknown>];

export interface SourceLocation {
  path: string;
  line?: number;
  column?: number;
}

export interface ProjectIdentity {
  name: string;
  root: string;
}

export interface BundlerFacts {
  name: BundlerName;
  version?: string;
  mode: string;
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

export interface DoctorOptions {
  moduleFederation?: ModuleFederationConfigLike;
  bundler?: BundlerName;
  bundlerVersion?: string;
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
  include?: string[];
  exclude?: string[];
  rules?: Record<string, RuleSetting>;
  extends?: DoctorRule[];
}

export interface ResolvedDoctorOptions {
  moduleFederation?: ModuleFederationConfigLike;
  bundler: BundlerName;
  bundlerVersion?: string;
  mode: "development" | "ci";
  root: string;
  runtimeTrace?: string;
  output: {
    directory: string;
    formats: OutputFormat[];
  };
  failOn: "never" | "warning" | "error";
  include: string[];
  exclude: string[];
  rules: Record<string, RuleSetting>;
  extends: DoctorRule[];
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
