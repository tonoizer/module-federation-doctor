import semver from "semver";
import path from "node:path";
import fs from "node:fs/promises";
import {
  bridgeOptions,
  browserBridgeReactEntries,
  detectedReactMajor,
  detectInvalidBridgeProviderShape,
  hasBridgeReactPlugin,
  hasBridgeServerEntry,
  hasBridgeVueServerEntry,
  hasReactDomPrefixShare,
  hasSharedPackage,
  hasSharedReactRouter,
  hasVueBridgeSsrFreshContextHints,
  isBridgeRouterEnabled,
  isNodeOrSsrTarget,
  isReactBridgeProject,
  isVueBridgeProject,
  reactBridgeEntryMajor,
  sharedReactRouterKeys,
  usesVueRouter,
} from "./bridge-detect.js";
import {
  isMfSsrFragmentRemoteEntry,
  shouldSkipBridgeEntryDtsGuidance,
  shouldSkipFragmentRemoteEntryInvalid,
  shouldSkipMf2SharedUnused,
} from "./mf-toolkit-shapes.js";
import { lookupAssetSize, sumAssetSizes } from "./collect.js";
import { ruleGuidance } from "./rule-guidance.js";
import {
  hasNodeRuntimePlugin,
  isBrowserOnlyManifestRemoteEntry,
  isSsrNodeEnvApplicable,
  NODE_RUNTIME_PLUGIN,
  nodeLibraryDtsProblems,
  optionSsrMode,
} from "./ssr-detect.js";
import {
  DEFAULT_ALWAYS_SHARED,
  DEFAULT_DEEP_IMPORT_ALLOWLIST,
  DEFAULT_SHARE_CANDIDATE_PACKAGES,
  DEFAULT_SINGLETON_RISK_PACKAGES,
  isShareKeyUsed,
} from "./shared-policy.js";
import {
  FINDING_DETAILS_SCHEMAS,
  findingDetails,
  type FindingDetailsAttachment,
} from "./finding-details.js";
import { findShareRewriteOverlaps } from "./share-rewrite.js";
import type {
  DoctorRule,
  NormalizedMFConfig,
  ProjectFacts,
  RuleContext,
  Severity,
} from "./types.js";

export function defineRule(rule: DoctorRule): DoctorRule {
  return rule;
}

function createRule(
  id: string,
  defaultSeverity: Severity,
  check: (context: RuleContext) => void | Promise<void>,
): DoctorRule {
  const guidance = ruleGuidance[id];
  if (!guidance) throw new Error(`Missing rule guidance for ${id}`);
  return defineRule({
    meta: {
      id,
      defaultSeverity,
      supportedBundlers: ["vite", "rspack", "rsbuild", "webpack", "modern", "unknown"],
      documentation: `/rules/${id}`,
      ...guidance,
    },
    check,
  });
}

function manifestAssetPath(manifestPath: string, asset: string): string {
  const normalizedAsset = asset.replaceAll("\\", "/").replace(/^\.\//, "");
  const manifestDir = path.posix.dirname(manifestPath);
  if (
    manifestDir === "." ||
    normalizedAsset === manifestDir ||
    normalizedAsset.startsWith(`${manifestDir}/`)
  )
    return normalizedAsset;
  return path.posix.normalize(path.posix.join(manifestDir, normalizedAsset));
}

function buildScopedAssetPath(
  context: { facts: ProjectFacts },
  manifestPath: string,
  asset: string,
): string {
  // When per-output build records exist, resolve assets against the manifest
  // directory so same-named files in other outputs cannot satisfy the rule.
  return context.facts.builds && context.facts.builds.length > 0
    ? manifestAssetPath(manifestPath, asset)
    : asset;
}

function emittedAssetMatches(
  context: { facts: ProjectFacts },
  manifestPath: string,
  candidate: string,
  asset: string,
): boolean {
  if (context.facts.builds && context.facts.builds.length > 0)
    return asset === manifestAssetPath(manifestPath, candidate);
  return asset.endsWith(candidate) || asset.endsWith(path.posix.basename(candidate));
}

function mf(context: RuleContext): NormalizedMFConfig | undefined {
  return context.facts.moduleFederation;
}

function report(
  context: RuleContext,
  message: string,
  evidence: Record<string, unknown>,
  suggestion?: string,
  typed?: FindingDetailsAttachment,
): void {
  context.report({
    message,
    evidence,
    ...(suggestion ? { suggestion } : {}),
    ...(typed
      ? { detailsSchema: typed.detailsSchema, details: typed.details as Record<string, unknown> }
      : {}),
  });
}

function cleanRange(range: string): string {
  return range === "*" || range === "workspace:*" ? "*" : range.replace(/^workspace:/, "");
}

function optionBoolean(options: Record<string, unknown>, key: string): boolean | undefined {
  return typeof options[key] === "boolean" ? options[key] : undefined;
}

function optionBytes(options: Record<string, unknown>, key: string, fallback: number): number {
  const value = options[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function optionStringList(options: Record<string, unknown>, key: string): string[] {
  const value = options[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function scopeList(value: string | string[] | undefined): string[] {
  return value === undefined ? ["default"] : Array.isArray(value) ? value : [value];
}

function singletonRiskSet(context: RuleContext): Set<string> {
  return new Set([
    ...(context.sharedPolicy?.singletonRisks ?? DEFAULT_SINGLETON_RISK_PACKAGES),
    ...optionStringList(context.options, "additionalPackages"),
  ]);
}

function shareCandidateSet(context: RuleContext): Set<string> {
  return new Set([
    ...(context.sharedPolicy?.shareCandidates ?? DEFAULT_SHARE_CANDIDATE_PACKAGES),
    ...optionStringList(context.options, "additionalPackages"),
  ]);
}

function reactHostMissingShared(
  context: RuleContext,
  imported = new Set([
    ...(context.facts.imports.packages ?? []),
    ...(context.facts.imports.dynamicPackages ?? []),
  ]),
): string[] {
  const config = mf(context);
  if (!config || Object.keys(config.remotes).length === 0) return [];
  const reactPackages = ["react", "react-dom"];
  return reactPackages.filter(
    (name) => imported.has(name) && !hasSharedPackage(config.shared, name),
  );
}

function alwaysSharedSet(context: RuleContext): Set<string> {
  return new Set([
    ...(context.sharedPolicy?.alwaysShared ?? DEFAULT_ALWAYS_SHARED),
    ...optionStringList(context.options, "alwaysShared"),
  ]);
}

function deepImportAllowlist(context: RuleContext): Set<string> {
  return new Set([
    ...(context.sharedPolicy?.deepImportAllowlist ?? DEFAULT_DEEP_IMPORT_ALLOWLIST),
    ...optionStringList(context.options, "allowlist"),
  ]);
}

function remoteEntryUrl(entry: string): string {
  return entry.includes("@") ? entry.slice(entry.lastIndexOf("@") + 1) : entry;
}

function isLoopbackRemoteUrl(url: string): boolean {
  return /^(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(url);
}

function isDemoLocalRemote(context: RuleContext, entry: string): boolean {
  if (!context.options.localDemoOnly || context.facts.bundler.mode !== "development") return false;
  const url = remoteEntryUrl(entry).trim();
  // Relative / bare entries are the normal local demo shape. Keep deployed
  // HTTPS and non-loopback hosts loud even when the demo pack is applied.
  return !/^[a-z][a-z\d+.-]*:\/\//i.test(url) && !url.startsWith("//")
    ? true
    : isLoopbackRemoteUrl(url);
}

/** Detect retry / errorLoadRemote recovery plugins from configured paths. */
function hasRemoteRecoveryPlugin(plugins: string[] | undefined): boolean {
  if (!plugins?.length) return false;
  return plugins.some((plugin) =>
    /(?:^|[/\\@])(?:retry-plugin|error-?load-?remote|shared?-strategy(?:-plugin)?)(?:[/\\@]|$)|errorLoadRemote/i.test(
      plugin,
    ),
  );
}

const SSR_FRAMEWORK_DEPS = ["nuxt", "nitropack", "@nuxt/kit", "@nuxt/schema"] as const;

function detectNitroSignal(facts: ProjectFacts): boolean {
  const declared = facts.dependencies.declared;
  return SSR_FRAMEWORK_DEPS.some((name) => name in declared);
}

function detectViteSsrSignal(facts: ProjectFacts): { detected: boolean; signals: string[] } {
  const signals: string[] = [];
  // Prefer MF-declared SSR targets and framework deps. Do not treat
  // `builds.targetKind=node` alone as SSR — Vite's default `ssr.target` is
  // `node`, so client builds often record that kind without being SSR apps.
  if (facts.moduleFederation?.vite?.target === "node") signals.push("vite.target=node");
  if (facts.moduleFederation?.experiments?.target === "node")
    signals.push("experiments.target=node");
  for (const build of facts.builds ?? []) {
    if (build.targetKind === "ssr") signals.push("builds.targetKind=ssr");
  }
  if (detectNitroSignal(facts)) signals.push("deps:nitropack|nuxt");
  return { detected: signals.length > 0, signals: [...new Set(signals)].sort() };
}

function dtsOptions(config: NormalizedMFConfig | undefined): Record<string, unknown> {
  return config?.dts?.options ?? {};
}

function generateTypesOptions(config: NormalizedMFConfig | undefined): Record<string, unknown> {
  const options = dtsOptions(config);
  const generateTypes = options.generateTypes;
  if (generateTypes && typeof generateTypes === "object")
    return generateTypes as Record<string, unknown>;
  return options;
}

const DEFAULT_REMOTE_ENTRY_MAX_BYTES = 524_288;
const DEFAULT_SHARED_MAX_BYTES = 524_288;
const DEFAULT_EXPOSE_MAX_BYTES = 358_400;

export const builtInRules: DoctorRule[] = [
  createRule("config/name-required", "error", (context) => {
    if (mf(context) && !mf(context)?.name?.trim())
      report(context, "Module Federation config needs a non-empty name.", {}, "Set `name`.");
  }),
  createRule("config/expose-key-invalid", "error", (context) => {
    for (const key of Object.keys(mf(context)?.exposes ?? {}))
      if (!key.startsWith("./") || key === "./")
        report(context, `Expose key "${key}" must start with "./".`, { key });
  }),
  createRule("config/expose-path-missing", "error", (context) => {
    for (const [key, target] of Object.entries(mf(context)?.exposes ?? {})) {
      const normalized = target.replaceAll("\\", "/").replace(/^\.\/+/, "");
      if (!context.facts.imports.sourceFiles.includes(normalized))
        report(
          context,
          `Exposed module "${key}" points to a missing file.`,
          { key, target },
          "Fix the path or create the file.",
        );
    }
  }),
  createRule("config/remote-entry-invalid", "error", (context) => {
    for (const [name, remote] of Object.entries(mf(context)?.remotes ?? {})) {
      // mf-ssr fragment URL/path remotes are intentional toolkit shapes, not broken entries.
      if (shouldSkipFragmentRemoteEntryInvalid(context, remote.entry)) continue;
      if (
        !remote.version &&
        (!remote.entry || (!remote.entry.includes("@") && !/^https?:\/\//.test(remote.entry)))
      )
        report(
          context,
          `Remote "${name}" has an invalid entry.`,
          {
            name,
            entry: remote.entry,
          },
          undefined,
          findingDetails(FINDING_DETAILS_SCHEMAS.REMOTES_CONFIG, {
            remote: name,
            entry: remote.entry,
          }),
        );
    }
  }),
  createRule("config/filename-invalid", "error", (context) => {
    const filename = mf(context)?.filename;
    if (
      filename &&
      (filename.startsWith("/") ||
        filename.includes("\\") ||
        filename.split("/").includes("..") ||
        !/\.m?js(?:$|\?)/.test(filename))
    )
      report(
        context,
        `Remote entry filename "${filename}" is unsafe or is not JavaScript.`,
        { filename },
        "Use a relative `.js` or `.mjs` filename without `..` path segments.",
      );
  }),
  createRule("config/remote-http-insecure", "warning", (context) => {
    for (const [name, remote] of Object.entries(mf(context)?.remotes ?? {})) {
      const url = remoteEntryUrl(remote.entry);
      if (
        url.startsWith("http://") &&
        !/^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/.test(url)
      )
        report(
          context,
          `Remote "${name}" uses plain HTTP outside localhost.`,
          { name, entry: remote.entry },
          "Use HTTPS so remote code cannot be changed in transit.",
          findingDetails(FINDING_DETAILS_SCHEMAS.REMOTES_CONFIG, {
            remote: name,
            entry: remote.entry,
          }),
        );
    }
  }),
  createRule("config/remote-localhost-in-production", "warning", (context) => {
    if (context.facts.bundler.mode !== "ci") return;
    for (const [name, remote] of Object.entries(mf(context)?.remotes ?? {})) {
      const url = remoteEntryUrl(remote.entry);
      if (!isLoopbackRemoteUrl(url)) continue;
      report(
        context,
        `Remote "${name}" points at localhost in a CI/production Doctor run.`,
        { name, entry: remote.entry, mode: context.facts.bundler.mode },
        "Use deployed remote URLs for CI and production builds; keep localhost for local development mode.",
        findingDetails(FINDING_DETAILS_SCHEMAS.REMOTES_CONFIG, {
          remote: name,
          entry: remote.entry,
          mode: context.facts.bundler.mode,
        }),
      );
    }
  }),
  createRule("config/duplicate-plugin-registration", "error", (context) => {
    const count = context.facts.bundler.moduleFederationPluginCount;
    if (count === undefined || count <= 1) return;
    report(
      context,
      `Module Federation is registered ${count} times on this compiler.`,
      { moduleFederationPluginCount: count },
      "Keep a single Module Federation plugin instance per compiler.",
    );
  }),
  createRule("config/remote-alias-prefix-collision", "error", (context) => {
    const remotes = Object.values(mf(context)?.remotes ?? {});
    for (const remote of remotes) {
      const alias = remote.alias;
      if (!alias) continue;
      const collision = remotes.find(
        (item) =>
          item !== remote &&
          (item.name.startsWith(alias) ||
            (item.alias !== undefined && item.alias.startsWith(alias))),
      );
      if (!collision) continue;
      report(
        context,
        `Remote alias "${alias}" is a prefix of remote "${collision.name}"${collision.alias ? ` (alias "${collision.alias}")` : ""}.`,
        { alias, remote: remote.name, collision: collision.name, collisionAlias: collision.alias },
        "Rename aliases so none is a prefix of another remote name or alias.",
        findingDetails(FINDING_DETAILS_SCHEMAS.REMOTES_CONFIG, {
          remote: remote.name,
          alias,
          collision: collision.name,
          ...(collision.alias !== undefined ? { collisionAlias: collision.alias } : {}),
        }),
      );
    }
  }),
  createRule("config/nested-producer-dts-extract", "warning", (_context) => {
    // A config with exposes and remotes is not enough evidence. The warning is
    // deferred until the collector can prove an exposed module re-exports a
    // configured remote through its local import graph.
    return;
  }),
  createRule("config/dts-output-dir-mismatch", "warning", (context) => {
    const config = mf(context);
    if (!config || config.dts?.enabled === false) return;
    const filename = config.filename;
    if (!filename || !filename.includes("/")) return;
    const outputDir = generateTypesOptions(config).outputDir;
    if (typeof outputDir !== "string" || !outputDir.trim()) return;
    const filenameDir = filename.replace(/\/[^/]+$/, "").replace(/^\.\//, "");
    const normalizedOutput = outputDir.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
    if (
      filenameDir === normalizedOutput ||
      normalizedOutput.endsWith(`/${filenameDir}`) ||
      filenameDir.endsWith(`/${normalizedOutput}`)
    )
      return;
    report(
      context,
      `Remote entry filename directory "${filenameDir}" does not align with dts outputDir "${normalizedOutput}".`,
      { filename, filenameDir, outputDir: normalizedOutput },
      "Align `filename` nesting with `dts.generateTypes.outputDir` so type archives resolve next to the container.",
    );
  }),
  createRule("config/remote-type-urls-missing", "warning", (_context) => {
    // The default producer output is inferred from a direct remoteEntry.js
    // (`@mf-types.zip`). Without producer artifacts or an explicit mismatch,
    // Doctor has no proof that the inferred URL is wrong, so stay silent.
    return;
  }),
  createRule("artifact/public-path-non-string-manifest", "warning", (context) => {
    const config = mf(context);
    if (!config?.manifest?.enabled) return;
    if (context.facts.bundler.outputPublicPathKind !== "non-string") return;
    report(
      context,
      "Manifest generation is skipped because bundler `output.publicPath` is not a string.",
      { outputPublicPathKind: context.facts.bundler.outputPublicPathKind },
      "Set `output.publicPath` to a string URL, root-relative path, or `auto`.",
      findingDetails(FINDING_DETAILS_SCHEMAS.ARTIFACT, {
        outputPublicPathKind: context.facts.bundler.outputPublicPathKind,
      }),
    );
  }),
  createRule("config/remote-manifest-recommended", "info", (context) => {
    for (const [name, remote] of Object.entries(mf(context)?.remotes ?? {}))
      if (
        /remoteEntry(?:\.[cm]?js)?(?:[?#]|$)/i.test(remote.entry) &&
        !isDemoLocalRemote(context, remote.entry)
      )
        report(
          context,
          `Remote "${name}" points straight to a remote entry.`,
          { name, entry: remote.entry },
          "Prefer `mf-manifest.json` when you need dynamic type hints, preloading, and DevTools metadata.",
          findingDetails(FINDING_DETAILS_SCHEMAS.REMOTES_CONFIG, {
            remote: name,
            entry: remote.entry,
          }),
        );
  }),
  createRule("config/library-remote-type-mismatch", "warning", (context) => {
    const config = mf(context);
    const libraryType = config?.library?.type;
    if (
      libraryType &&
      config?.remoteType &&
      ((libraryType === "module" &&
        !["module", "import", "module-import"].includes(config.remoteType)) ||
        (libraryType !== "module" &&
          ["module", "import", "module-import"].includes(config.remoteType)))
    )
      report(
        context,
        "The container library type and remote loading type may not interoperate.",
        { libraryType, remoteType: config.remoteType },
        "Make the producer library format and consumer remote type agree.",
      );
  }),
  createRule("config/share-scope-undeclared", "error", (context) => {
    const config = mf(context);
    if (!config) return;
    const declared = new Set(config.shareScope ?? ["default"]);
    for (const [name, shared] of Object.entries(config.shared))
      for (const scope of scopeList(shared.shareScope))
        if (!declared.has(scope))
          report(
            context,
            `Shared package "${name}" uses undeclared scope "${scope}".`,
            { package: name, scope, declaredScopes: [...declared] },
            "Add the scope to the top-level `shareScope` option or use a declared scope.",
          );
  }),
  createRule("config/runtime-plugin-missing", "error", (context) => {
    const files = new Set(context.facts.imports.sourceFiles);
    for (const plugin of mf(context)?.runtimePlugins ?? []) {
      if (!plugin.startsWith(".") && !plugin.startsWith("/")) continue;
      const normalized = plugin.replaceAll("\\", "/").replace(/^\.\/+/, "");
      const candidates = [
        normalized,
        `${normalized}.ts`,
        `${normalized}.tsx`,
        `${normalized}.js`,
        `${normalized}.mjs`,
        `${normalized}/index.ts`,
        `${normalized}/index.js`,
      ];
      if (!candidates.some((candidate) => files.has(candidate)))
        report(
          context,
          `Runtime plugin "${plugin}" does not resolve to a scanned source file.`,
          { plugin },
          "Fix the runtime plugin path or include that file in Doctor's source scan.",
        );
    }
  }),
  createRule("config/get-public-path-invalid", "error", (context) => {
    const source = mf(context)?.getPublicPath;
    if (!source) return;
    const looksValid =
      /^\s*(?:async\s+)?function\b/.test(source) ||
      /^\s*(?:\([^)]*\)|[\w$]+)\s*=>/.test(source) ||
      /^\s*return\b/.test(source);
    if (!looksValid)
      report(
        context,
        "`getPublicPath` is not a stringified function or return statement.",
        { valueLength: source.length },
        "Use `function () { return ... }`, an arrow function, or `return ...`.",
      );
  }),
  createRule("config/get-public-path-unused", "info", (context) => {
    const config = mf(context);
    if (config?.getPublicPath && Object.keys(config.exposes).length === 0)
      report(
        context,
        "`getPublicPath` has no effect because this project exposes no modules.",
        {},
        "Remove it or add exposes.",
      );
  }),
  createRule("security/get-public-path-dynamic-code", "warning", (context) => {
    const source = mf(context)?.getPublicPath;
    if (source)
      report(
        context,
        "`getPublicPath` is executed as dynamic code at runtime.",
        { valueLength: source.length },
        "Keep it static, review it like executable code, and never build it from untrusted input.",
      );
  }),
  // Heuristic package/path check — advisory `info` unless teams elevate it.
  createRule("config/implementation-suspicious", "info", (context) => {
    const implementation = mf(context)?.implementation;
    if (
      implementation &&
      !implementation.includes("@module-federation/runtime-tools") &&
      !implementation.startsWith(".") &&
      !implementation.startsWith("/") &&
      !implementation.startsWith("[external]/")
    )
      report(
        context,
        "The custom runtime implementation is not `@module-federation/runtime-tools` or a local path.",
        { implementation },
        "Verify that the implementation exports the runtime contract required by this plugin version.",
      );
  }),
  createRule("config/external-runtime-with-exposes", "error", (context) => {
    const config = mf(context);
    if (config?.experiments?.provideExternalRuntime && Object.keys(config.exposes).length > 0)
      report(
        context,
        "`provideExternalRuntime` is only valid for a pure consumer.",
        { exposes: Object.keys(config.exposes) },
        "Move the provider flag to the top-level consumer or remove exposes.",
      );
  }),
  createRule("config/external-runtime-conflict", "error", (context) => {
    const experiments = mf(context)?.experiments;
    if (experiments?.externalRuntime && experiments.provideExternalRuntime)
      report(
        context,
        "One build cannot both externalize and provide the shared runtime.",
        {},
        "Use `provideExternalRuntime` on the pure consumer and `externalRuntime` on its browser remotes.",
      );
  }),
  createRule("config/remote-capability-disabled", "error", (context) => {
    const config = mf(context);
    if (
      (config?.vite?.disableRemote || config?.experiments?.disableRemote) &&
      Object.keys(config.remotes).length > 0
    )
      report(
        context,
        "Remote-consumption runtime code is disabled while remotes are configured.",
        { remotes: Object.keys(config.remotes) },
        "Remove `disableRemote` or remove all consumed remotes.",
        findingDetails(FINDING_DETAILS_SCHEMAS.REMOTES_CONFIG, {
          remotes: Object.keys(config.remotes),
        }),
      );
  }),
  createRule("config/shared-capability-disabled", "error", (context) => {
    const config = mf(context);
    if (
      (config?.vite?.disableShared || config?.experiments?.disableShared) &&
      Object.keys(config.shared).length > 0
    )
      report(
        context,
        "Shared-dependency runtime code is disabled while shared packages are configured.",
        { shared: Object.keys(config.shared) },
        "Remove `disableShared` or remove the shared configuration.",
      );
  }),
  createRule("reliability/snapshot-capability-disabled", "warning", (context) => {
    const config = mf(context);
    const disabled = config?.vite?.disableSnapshot || config?.experiments?.disableSnapshot;
    if (
      disabled &&
      (config.manifest?.enabled ||
        Object.values(config.remotes).some((remote) => /\.json(?:[?#]|$)/.test(remote.entry)))
    )
      report(
        context,
        "Snapshot support is disabled while manifest-powered features are configured.",
        {},
        "Enable snapshots, or accept losing manifest remotes, preload, dynamic types, HMR, and DevTools integration.",
      );
  }),
  createRule("config/eager-tree-shaking-conflict", "error", (context) => {
    for (const [name, shared] of Object.entries(mf(context)?.shared ?? {}))
      if (shared.eager && shared.treeShaking)
        report(
          context,
          `Shared package "${name}" enables both eager loading and tree shaking.`,
          { package: name },
          "Choose eager loading for a small initial dependency or tree shaking for on-demand exports.",
        );
  }),
  createRule("reliability/external-runtime-provider-unverified", "warning", (context) => {
    if (mf(context)?.experiments?.externalRuntime)
      report(
        context,
        "This build requires `_FEDERATION_RUNTIME_CORE` to exist before its remote graph runs.",
        {},
        "Verify a top-level pure consumer enables `provideExternalRuntime` and loads first.",
      );
  }),
  createRule("reliability/async-startup-library-promise", "warning", (context) => {
    const config = mf(context);
    if (
      config?.experiments?.asyncStartup &&
      config.library?.type &&
      !["module", "commonjs", "commonjs2"].includes(config.library.type)
    )
      report(
        context,
        "Async startup makes this library entry return a Promise.",
        { libraryType: config.library.type },
        "Make consumers await the entry exports, or disable async startup for this library contract.",
      );
  }),
  createRule("performance/version-first-startup", "info", (context) => {
    const config = mf(context);
    const threshold = Number(context.options["remoteThreshold"] ?? 3);
    if (
      config?.shareStrategy === "version-first" &&
      Object.keys(config.remotes).length >= threshold
    )
      report(
        context,
        "`version-first` loads every configured remote entry during startup.",
        { remoteCount: Object.keys(config.remotes).length, threshold },
        "Consider `loaded-first` when on-demand loading matters more than highest-version selection.",
      );
  }),
  createRule("performance/asset-budget", "warning", (context) => {
    const manifest = context.facts.artifacts.manifest;
    const sizes = context.facts.artifacts.assetSizes;
    if (!manifest?.valid || !sizes || Object.keys(sizes).length === 0) return;

    const remoteEntryMax = optionBytes(
      context.options,
      "remoteEntryMaxBytes",
      DEFAULT_REMOTE_ENTRY_MAX_BYTES,
    );
    const sharedMax = optionBytes(context.options, "sharedMaxBytes", DEFAULT_SHARED_MAX_BYTES);
    const exposeMax = optionBytes(context.options, "exposeMaxBytes", DEFAULT_EXPOSE_MAX_BYTES);
    const suggestion =
      "Reduce the oversized assets or raise the matching `remoteEntryMaxBytes`, `sharedMaxBytes`, or `exposeMaxBytes` rule option.";

    if (manifest.remoteEntry?.name) {
      const assets = [manifest.remoteEntry.name];
      const bytes = lookupAssetSize(
        sizes,
        buildScopedAssetPath(context, manifest.path, manifest.remoteEntry.name),
      );
      if (bytes !== undefined && bytes > remoteEntryMax)
        report(
          context,
          `Remote entry exceeds the ${remoteEntryMax} byte budget (${bytes} bytes).`,
          {
            class: "remoteEntry",
            target: manifest.remoteEntry.name,
            bytes,
            maxBytes: remoteEntryMax,
            assets,
          },
          suggestion,
        );
    }

    for (const shared of manifest.shared) {
      const bytes = sumAssetSizes(
        sizes,
        shared.assets.map((asset) => buildScopedAssetPath(context, manifest.path, asset)),
      );
      if (bytes === undefined || bytes <= sharedMax) continue;
      report(
        context,
        `Shared package "${shared.name}" exceeds the ${sharedMax} byte budget (${bytes} bytes).`,
        {
          class: "shared",
          target: shared.name,
          bytes,
          maxBytes: sharedMax,
          assets: shared.assets,
        },
        suggestion,
      );
    }

    for (const expose of manifest.exposes) {
      const bytes = sumAssetSizes(
        sizes,
        expose.assets.map((asset) => buildScopedAssetPath(context, manifest.path, asset)),
      );
      if (bytes === undefined || bytes <= exposeMax) continue;
      report(
        context,
        `Expose "${expose.key}" exceeds the ${exposeMax} byte budget (${bytes} bytes).`,
        {
          class: "expose",
          target: expose.key,
          bytes,
          maxBytes: exposeMax,
          assets: expose.assets,
        },
        suggestion,
      );
    }
  }),
  createRule("reliability/version-first-offline-remotes", "warning", (context) => {
    const config = mf(context);
    if (
      config?.shareStrategy === "version-first" &&
      Object.keys(config.remotes).length > 0 &&
      !hasRemoteRecoveryPlugin(config.runtimePlugins) &&
      !(
        context.options.localDemoOnly &&
        context.facts.bundler.mode === "development" &&
        Object.values(config.remotes).every((remote) => isDemoLocalRemote(context, remote.entry))
      )
    )
      report(
        context,
        "`version-first` can fail startup when a remote is offline and no retry/`errorLoadRemote` recovery plugin is configured.",
        {
          remoteCount: Object.keys(config.remotes).length,
          runtimePlugins: config.runtimePlugins ?? [],
        },
        "Add `@module-federation/retry-plugin` or an `errorLoadRemote` runtime plugin, or use `loaded-first` when delayed failure is acceptable.",
      );
  }),
  createRule("reliability/shared-import-false", "warning", (context) => {
    for (const [name, shared] of Object.entries(mf(context)?.shared ?? {}))
      if (shared.import === false)
        report(
          context,
          `Shared package "${name}" has no local fallback.`,
          { package: name, scopes: scopeList(shared.shareScope) },
          "Verify another build always provides it before this project calls `loadShare`.",
        );
  }),
  createRule("config/tree-shaking-server-calc-injection", "warning", (context) => {
    const config = mf(context);
    if (
      config?.treeShaking?.injectUsedExports === true &&
      Object.values(config.shared).some((shared) => shared.treeShaking?.mode === "server-calc")
    )
      report(
        context,
        "`injectTreeShakingUsedExports` should be false with `server-calc` shared tree shaking.",
        {},
        "Disable injection and let the deployment service merge used exports.",
      );
  }),
  createRule("reliability/tree-shaking-server-calc-contract", "warning", (context) => {
    const config = mf(context);
    const packages = Object.entries(config?.shared ?? {})
      .filter(([, shared]) => shared.treeShaking?.mode === "server-calc")
      .map(([name]) => name);
    if (packages.length > 0 && !config?.treeShaking?.directory)
      report(
        context,
        "Server-calculated shared tree shaking has no fallback output directory.",
        { packages },
        "Set `treeShakingDir` and make the deployment service merge metadata and publish secondary artifacts.",
      );
  }),
  createRule("performance/vite-bundle-all-css", "warning", (context) => {
    const config = mf(context);
    if (
      context.facts.bundler.name === "vite" &&
      config?.vite?.bundleAllCSS &&
      Object.keys(config.exposes).length > 1
    )
      report(
        context,
        "Vite will attach all bundle CSS to every exposed module.",
        { exposeCount: Object.keys(config.exposes).length },
        "Disable `bundleAllCSS` unless every expose truly needs the full stylesheet set.",
      );
  }),
  createRule("reliability/vite-fixed-parse-timeout", "info", (context) => {
    const vite = mf(context)?.vite;
    if (
      context.facts.bundler.name === "vite" &&
      vite?.moduleParseTimeout &&
      !vite.moduleParseIdleTimeout
    )
      report(
        context,
        "Vite uses a fixed module-parse timeout.",
        { seconds: vite.moduleParseTimeout },
        "For large builds, prefer `moduleParseIdleTimeout` so active parsing does not end early.",
      );
  }),
  createRule("vite/remotes-prefer-module", "warning", (context) => {
    if (context.facts.bundler.name !== "vite") return;
    const config = mf(context);
    const remotes = config?.remotes;
    if (!remotes || Object.keys(remotes).length === 0) return;
    if (optionBoolean(context.options, "preferModuleRemotes") === false) return;

    const varFilename = config?.vite?.varFilename;
    const allowVarWithFilename =
      optionBoolean(context.options, "allowVarRemotesWithVarFilename") !== false;
    if (varFilename && allowVarWithFilename) return;

    // Vite string remotes / omitted type default to `var`. Explicit types such as
    // `module` or `global` are intentional and stay quiet.
    const defaultVarRemotes = Object.entries(remotes)
      .filter(([, remote]) => !remote.type || remote.type === "var")
      .map(([name, remote]) => ({
        name,
        type: remote.type ?? "var",
        entry: remote.entry,
      }));
    if (defaultVarRemotes.length === 0) return;

    report(
      context,
      "Vite remotes use string or default `var` typing without an intentional interop story.",
      {
        remotes: defaultVarRemotes,
        ...(varFilename ? { varFilename } : {}),
      },
      "Prefer object remotes with `type: 'module'` for Vite↔Vite ESM. For webpack/rspack remotes, set an explicit type such as `global`. Keep `varFilename` when this producer intentionally emits a var entry for var hosts.",
    );
  }),
  createRule("vite/var-filename-interop", "info", (context) => {
    if (context.facts.bundler.name !== "vite") return;
    const config = mf(context);
    const varFilename = config?.vite?.varFilename;
    if (!varFilename) return;
    const remotes = config?.remotes ?? {};
    if (Object.keys(remotes).length === 0) return;

    const defaultVarRemotes = Object.entries(remotes)
      .filter(([, remote]) => !remote.type || remote.type === "var")
      .map(([name, remote]) => ({
        name,
        type: remote.type ?? "var",
        entry: remote.entry,
      }));
    if (defaultVarRemotes.length === 0) return;

    report(
      context,
      "`varFilename` is configured while remotes still use default `var` typing.",
      { varFilename, remotes: defaultVarRemotes },
      "Keep `varFilename` when this producer serves webpack/rspack var hosts. Prefer `type: 'module'` remotes for Vite↔Vite ESM consumers.",
    );
  }),
  createRule("vite/host-init-inject-ssr", "error", (context) => {
    if (context.facts.bundler.name !== "vite") return;
    const config = mf(context);
    if (!config) return;
    if (optionBoolean(context.options, "requireHostInitEntryForSsr") === false) return;

    const inject = config.vite?.hostInitInjectLocation;
    const ssr = detectViteSsrSignal(context.facts);
    if (!ssr.detected) {
      // Browser-only / unknown: unset stays silent; explicit `html` is valid for SPA hosts.
      return;
    }
    if (inject === "entry") return;

    report(
      context,
      "SSR Vite apps need `hostInitInjectLocation: 'entry'`.",
      {
        hostInitInjectLocation: inject ?? null,
        signals: ssr.signals,
      },
      "Set `hostInitInjectLocation` to `entry` so federation host init runs without an HTML document.",
    );
  }),
  createRule("vite/ssr-nitro-externals", "warning", (context) => {
    if (context.facts.bundler.name !== "vite") return;
    const config = mf(context);
    if (!config) return;

    const ssr = detectViteSsrSignal(context.facts);
    const nitro = detectNitroSignal(context.facts);
    if (!ssr.detected && !nitro) return;

    const sharedReact = Object.keys(config.shared).filter(
      (name) => name === "react" || name === "react-dom" || name.startsWith("react/"),
    );
    if (sharedReact.length === 0) return;

    const externals = new Set(config.vite?.ssrExternals ?? []);
    const overlapping = sharedReact.filter((name) => {
      if (externals.has(name)) return true;
      if (name === "react" || name.startsWith("react/")) return externals.has("react");
      if (name === "react-dom") return externals.has("react-dom");
      return false;
    });
    const loader = config.vite?.ssrEntryLoader;
    // Honest skip when there is no externals/loader fact to correlate — only
    // Nitro/SSR with shared React and either overlap or an explicit loader.
    if (overlapping.length === 0 && !loader) return;

    report(
      context,
      "Shared React may conflict with Vite SSR / Nitro externals.",
      {
        sharedReact,
        ...(overlapping.length > 0 ? { ssrExternalsOverlap: overlapping } : {}),
        ...(loader ? { ssrEntryLoader: loader } : {}),
        signals: [...ssr.signals, ...(nitro ? ["deps:nitropack|nuxt"] : [])],
      },
      "Align shared React with `ssrExternals` / `ssrEntryLoader`, or remove the share when Nitro owns the server React instance.",
    );
  }),
  createRule("vite/manual-chunks-conflict", "warning", (context) => {
    if (context.facts.bundler.name !== "vite") return;
    if (optionBoolean(context.options, "allowManualChunks") === true) return;
    const viteConfig = context.facts.bundler.viteConfig;
    if (!viteConfig) return;
    if (!viteConfig.manualChunks && !viteConfig.codeSplittingGroups) return;
    report(
      context,
      "User manualChunks / codeSplitting.groups can conflict with federation bootstrap chunk ownership.",
      {
        manualChunks: Boolean(viteConfig.manualChunks),
        codeSplittingGroups: Boolean(viteConfig.codeSplittingGroups),
      },
      "Move general chunk tuning outside the federation runtime graph, or set `allowManualChunks: true` when the layout is proven safe.",
    );
  }),
  createRule("vite/hashed-remote-filename", "warning", (context) => {
    if (context.facts.bundler.name !== "vite") return;
    const filename = mf(context)?.filename;
    if (!filename) return;
    const mode = context.options["hashedFilenameMode"];
    if (mode === "allow") return;
    if (!/\[[^\]]*hash[^\]]*\]|contenthash|fullhash/i.test(filename)) return;
    report(
      context,
      "Hashed remote entry filenames break stable consumer URLs.",
      { filename },
      "Use a stable remote entry filename (for example `remoteEntry.js`) and keep hashing on chunks instead.",
    );
  }),
  createRule("vite/remote-hmr-dev", "info", (context) => {
    if (context.facts.bundler.name !== "vite") return;
    if (context.facts.bundler.mode !== "development") return;
    const config = mf(context);
    if (!config) return;
    // remoteHmr unknown → skip (do not invent). Explicit false or missing after normalize skip.
    if (config.vite?.remoteHmr === undefined) return;
    if (config.vite.remoteHmr) return;
    if (optionBoolean(context.options, "requireRemoteHmrInDev") === false) return;
    if (Object.keys(config.remotes).length === 0 && Object.keys(config.exposes).length === 0)
      return;
    report(
      context,
      "`remoteHmr` is disabled in development.",
      { remoteHmr: false },
      "Enable `remoteHmr` for local Vite remotes when HMR across containers is desired.",
    );
  }),
  createRule("vite/alias-share-bypass", "warning", (context) => {
    if (context.facts.bundler.name !== "vite") return;
    if (context.options["aliasShareBypassMode"] === "off") return;
    const aliases = context.facts.bundler.viteConfig?.resolveAliases;
    if (!aliases) return;
    const sharedKeys = Object.keys(mf(context)?.shared ?? {});
    if (sharedKeys.length === 0) return;
    const overlaps = findShareRewriteOverlaps(
      Object.keys(aliases),
      sharedKeys,
      optionStringList(context.options, "allowPackages"),
    );
    if (overlaps.length === 0) return;
    report(
      context,
      "resolve.alias rewrites packages that are also listed in shared.",
      { overlaps, aliases: Object.fromEntries(overlaps.map((key) => [key, aliases[key]])) },
      "Remove the alias, exclude the package from shared, or allowlist intentional bypasses via `allowPackages`.",
    );
  }),
  createRule("vite/server-origin", "warning", (context) => {
    if (context.facts.bundler.name !== "vite") return;
    if (optionBoolean(context.options, "requireServerOrigin") === false) return;
    const remotes = mf(context)?.remotes ?? {};
    if (Object.keys(remotes).length === 0) return;
    const viteConfig = context.facts.bundler.viteConfig;
    // Origin fact absent (CLI partial) → skip.
    if (!viteConfig || !("serverOrigin" in viteConfig)) return;
    if (typeof viteConfig.serverOrigin === "string" && viteConfig.serverOrigin.length > 0) return;
    report(
      context,
      "`server.origin` is missing while this app consumes remotes.",
      { serverOrigin: viteConfig.serverOrigin ?? null },
      "Set `server.origin` to the public origin remote consumers should use in development.",
    );
  }),
  createRule("config/transform-import-share-conflict", "warning", (context) => {
    const libraries = context.facts.bundler.transformImportLibraries;
    if (!libraries || libraries.length === 0) return;
    const sharedKeys = Object.keys(mf(context)?.shared ?? {});
    if (sharedKeys.length === 0) return;
    const overlaps = findShareRewriteOverlaps(
      libraries,
      sharedKeys,
      optionStringList(context.options, "allowPackages"),
    );
    if (overlaps.length === 0) return;
    report(
      context,
      "transformImport rewrites packages that are also listed in shared.",
      { overlaps, transformImport: libraries, shared: sharedKeys },
      "Remove the transformImport entry, exclude the package from shared, or allowlist via `allowPackages`. See also vite/alias-share-bypass for Vite resolve.alias.",
    );
  }),
  createRule("artifact/manifest-assets-disabled", "warning", (context) => {
    const config = mf(context);
    if (
      config?.manifest?.enabled &&
      optionBoolean(config.manifest.options, "disableAssetsAnalyze") === true &&
      Object.keys(config.exposes).length > 0
    )
      report(
        context,
        "Manifest asset analysis is disabled for a producer.",
        { exposes: Object.keys(config.exposes) },
        "Enable asset analysis for production manifests; disabled analysis omits shared and expose asset detail.",
        findingDetails(FINDING_DETAILS_SCHEMAS.ARTIFACT, {
          exposes: Object.keys(config.exposes),
        }),
      );
  }),
  createRule("artifact/manifest-disabled", "info", (context) => {
    const config = mf(context);
    // Prefer emit evidence over normalized defaults (Enhanced omits → still emits).
    if (context.facts.capabilities.manifest || context.facts.artifacts.manifest) return;
    if (
      config &&
      !config.manifest?.enabled &&
      (Object.keys(config.exposes).length > 0 || Object.keys(config.remotes).length > 0)
    )
      report(
        context,
        "Manifest generation is disabled.",
        {},
        "Enable `manifest` for runtime metadata, preload analysis, DevTools, and stronger Doctor checks.",
        findingDetails(FINDING_DETAILS_SCHEMAS.ARTIFACT, {}),
      );
  }),
  createRule("artifact/dts-disabled", "warning", (context) => {
    const config = mf(context);
    // mf-bridge `./entry`+register producers are not classic component exposes needing DTS.
    if (shouldSkipBridgeEntryDtsGuidance(context)) return;
    if (config && config.dts?.enabled === false && Object.keys(config.exposes).length > 0)
      report(
        context,
        "Federated type generation is disabled for a producer.",
        { exposes: Object.keys(config.exposes) },
        "Enable `dts.generateTypes`, or document how consumers receive compatible declarations.",
        findingDetails(FINDING_DETAILS_SCHEMAS.ARTIFACT, {
          exposes: Object.keys(config.exposes),
        }),
      );
  }),
  createRule("shared/version-unsatisfied", "error", (context) => {
    for (const [name, shared] of Object.entries(mf(context)?.shared ?? {})) {
      const installed = context.facts.dependencies.installed[name];
      if (
        installed &&
        typeof shared.requiredVersion === "string" &&
        semver.valid(installed) &&
        semver.validRange(cleanRange(shared.requiredVersion)) &&
        !semver.satisfies(installed, cleanRange(shared.requiredVersion))
      )
        report(
          context,
          `"${name}" does not satisfy its shared version range.`,
          {
            package: name,
            installed,
            requiredVersion: shared.requiredVersion,
          },
          undefined,
          findingDetails(FINDING_DETAILS_SCHEMAS.SHARED_VERSION_MISMATCH, {
            package: name,
            source: "requiredVersion",
            installed,
            requiredVersion: shared.requiredVersion,
          }),
        );
    }
  }),
  createRule("artifact/manifest-invalid", "error", (context) => {
    const manifest = context.facts.artifacts.manifest;
    if (manifest && !manifest.valid)
      report(
        context,
        "Module Federation manifest is not valid JSON or has an invalid shape.",
        {
          path: manifest.path,
        },
        undefined,
        findingDetails(FINDING_DETAILS_SCHEMAS.ARTIFACT, { path: manifest.path }),
      );
  }),
  createRule("artifact/manifest-name-mismatch", "error", (context) => {
    const configName = mf(context)?.name;
    const manifestName = context.facts.artifacts.manifest?.name;
    if (configName && manifestName && configName !== manifestName)
      report(
        context,
        "The emitted manifest belongs to a different federation container name.",
        { configName, manifestName },
        "Clean the output directory and make the plugin and Doctor use the same options object.",
        findingDetails(FINDING_DETAILS_SCHEMAS.ARTIFACT, { configName, manifestName }),
      );
  }),
  createRule("artifact/manifest-remote-entry-missing", "error", (context) => {
    const manifest = context.facts.artifacts.manifest;
    const remoteEntry = manifest?.remoteEntry;
    if (!manifest?.valid || !remoteEntry || !context.facts.capabilities.emittedAssets) return;
    const candidate = `${remoteEntry.path}${remoteEntry.name}`;
    const emitted = context.facts.artifacts.emittedAssets.some((asset) =>
      emittedAssetMatches(context, manifest.path, candidate, asset),
    );
    // Vite often leaves remoteEntry.path empty while assetSizes still records the basename.
    const sized =
      remoteEntry.path === ""
        ? lookupAssetSize(context.facts.artifacts.assetSizes, remoteEntry.name) !== undefined
        : context.facts.artifacts.assetSizes?.[candidate] !== undefined;
    if (!emitted && !sized)
      report(
        context,
        "The remote entry named by the manifest was not emitted.",
        { remoteEntry },
        "Clean and rebuild; then verify filename, output path, and manifest generation use one config.",
        findingDetails(FINDING_DETAILS_SCHEMAS.ARTIFACT, { remoteEntry }),
      );
  }),
  createRule("artifact/manifest-expose-assets-empty", "warning", (context) => {
    const manifest = context.facts.artifacts.manifest;
    if (!manifest?.valid || mf(context)?.manifest?.options["disableAssetsAnalyze"] === true) return;
    // Vite/Nuxt generators commonly omit nested expose asset lists even when emit succeeded.
    if (
      context.facts.bundler.name === "vite" &&
      manifest.exposes.length > 0 &&
      manifest.exposes.every((expose) => expose.assets.length === 0)
    )
      return;
    for (const expose of manifest.exposes)
      if (expose.assets.length === 0)
        report(
          context,
          `Manifest expose "${expose.key}" has no asset metadata.`,
          { expose: expose.key },
          "Verify the expose was included in the build and asset analysis completed.",
          findingDetails(FINDING_DETAILS_SCHEMAS.ARTIFACT, { expose: expose.key }),
        );
  }),
  createRule("artifact/manifest-shared-version-mismatch", "warning", (context) => {
    const installed = context.facts.dependencies.installed;
    for (const shared of context.facts.artifacts.manifest?.shared ?? []) {
      const local = installed[shared.name];
      if (
        local &&
        shared.version &&
        semver.valid(local) &&
        semver.valid(shared.version) &&
        local !== shared.version
      )
        report(
          context,
          `Manifest metadata for "${shared.name}" does not match the installed version.`,
          { package: shared.name, installed: local, manifestVersion: shared.version },
          "Clean the build and lockfile install; stale manifest metadata can break version negotiation.",
          findingDetails(FINDING_DETAILS_SCHEMAS.SHARED_VERSION_MISMATCH, {
            package: shared.name,
            source: "manifest",
            installed: local,
            manifestVersion: shared.version,
          }),
        );
    }
  }),
  createRule("artifact/types-metadata-missing", "warning", (context) => {
    if (shouldSkipBridgeEntryDtsGuidance(context)) return;
    const manifest = context.facts.artifacts.manifest;
    if (
      manifest?.valid &&
      manifest.exposes.length > 0 &&
      mf(context)?.dts?.enabled !== false &&
      !manifest.types
    )
      report(
        context,
        "Producer manifest has no federated type metadata.",
        {},
        "Check DTS generation errors and ensure the manifest plugin receives type output metadata.",
        findingDetails(FINDING_DETAILS_SCHEMAS.ARTIFACT, {}),
      );
  }),
  createRule("artifact/remote-entry-missing", "error", (context) => {
    const config = mf(context);
    if (!config || !context.facts.capabilities.emittedAssets) return;
    const expected = config.filename ?? "remoteEntry.js";
    if (
      Object.keys(config.exposes).length > 0 &&
      !context.facts.artifacts.emittedAssets.some((asset) => asset.endsWith(expected))
    )
      report(
        context,
        `Expected remote entry "${expected}" was not emitted.`,
        { expected },
        undefined,
        findingDetails(FINDING_DETAILS_SCHEMAS.ARTIFACT, { expected }),
      );
  }),
  createRule("artifact/expose-missing", "error", (context) => {
    const config = mf(context);
    const manifest = context.facts.artifacts.manifest;
    if (!config || !manifest?.valid) return;
    const found = new Set(manifest.exposes.map((item) => item.key));
    for (const key of Object.keys(config.exposes))
      if (!found.has(key))
        report(
          context,
          `Expose "${key}" is missing from the manifest.`,
          { key },
          undefined,
          findingDetails(FINDING_DETAILS_SCHEMAS.ARTIFACT, { key }),
        );
  }),
  createRule("doctor/partial-analysis", "warning", (context) => {
    const missing = Object.entries(context.facts.capabilities)
      .filter(([, value]) => !value)
      .map(([name]) => name)
      .sort();
    if (!mf(context)) missing.push("moduleFederation");
    const unresolvedDynamic = context.facts.imports.unresolvedDynamic ?? [];
    const budget = context.facts.analysis;
    if (missing.length === 0 && unresolvedDynamic.length === 0 && !budget?.exceeded.length) return;
    const configMissing = missing.includes("config") || missing.includes("moduleFederation");
    const artifactOnlyMissing =
      !configMissing &&
      missing.length > 0 &&
      missing.every((name) => ["manifest", "stats", "emittedAssets"].includes(name));
    const viteArtifactSuggestion =
      context.facts.bundler.name === "vite" &&
      artifactOnlyMissing &&
      (missing.includes("manifest") || missing.includes("stats"))
        ? "Vite/@module-federation/vite does not emit `mf-manifest.json` / `mf-stats.json` unless `manifest: true` is set. Enable `manifest: true` for those artifacts; webpack-style compilation `stats.json` is not expected on Vite."
        : undefined;
    report(
      context,
      budget?.status === "unknown"
        ? "Doctor completed with unknown input due to an analysis budget."
        : unresolvedDynamic.length > 0 && missing.length === 0
          ? "Doctor completed with unresolved dynamic import patterns."
          : "Doctor completed with partial input.",
      {
        ...(missing.length > 0 ? { missing } : {}),
        ...(unresolvedDynamic.length > 0 ? { unresolvedDynamic } : {}),
        ...(budget?.exceeded.length ? { analysisBudget: budget } : {}),
        ...(context.facts.imports.evidenceSources
          ? { evidenceSources: context.facts.imports.evidenceSources }
          : {}),
      },
      unresolvedDynamic.length > 0
        ? "Prefer string-literal `import()` / `loadRemote` / `loadShare`, or pass an opt-in Observability export via `runtimeTrace` / `mfdoctor runtime`."
        : configMissing
          ? "Pass explicit MF options."
          : (viteArtifactSuggestion ??
            "Run Doctor through the bundler adapter after emit, or complete the missing inputs listed in evidence."),
      findingDetails(FINDING_DETAILS_SCHEMAS.DOCTOR_PARTIAL_ANALYSIS, {
        missing,
        ...(unresolvedDynamic.length > 0
          ? {
              unresolvedDynamic: unresolvedDynamic as unknown as Array<Record<string, unknown>>,
            }
          : {}),
        ...(context.facts.imports.evidenceSources
          ? { evidenceSources: context.facts.imports.evidenceSources }
          : {}),
      }),
    );
  }),
  createRule("config/plugin-package-mismatch", "warning", (context) => {
    const expected: Partial<Record<ProjectFacts["bundler"]["name"], string>> = {
      vite: "@module-federation/vite",
      rspack: "@module-federation/enhanced",
      rsbuild: "@module-federation/rsbuild-plugin",
      webpack: "@module-federation/enhanced",
    };
    const bundler = context.facts.bundler.name;
    if (bundler === "modern") {
      const declared = context.facts.dependencies.declared;
      const hasModern =
        Boolean(declared["@module-federation/modern-js"]) ||
        Boolean(declared["@module-federation/modern-js-v3"]);
      if (!hasModern) {
        report(
          context,
          'Expected "@module-federation/modern-js" or "@module-federation/modern-js-v3" for modern.',
          {
            bundler,
            expectedPackage: "@module-federation/modern-js",
          },
        );
      }
      return;
    }
    const packageName = expected[bundler];
    if (packageName && !context.facts.dependencies.declared[packageName])
      report(context, `Expected "${packageName}" for ${bundler}.`, {
        bundler,
        expectedPackage: packageName,
      });
  }),
  createRule("shared/singleton-risk", "warning", (context) => {
    const risks = singletonRiskSet(context);
    for (const [name, shared] of Object.entries(mf(context)?.shared ?? {}))
      if (risks.has(name) && !shared.singleton)
        report(
          context,
          `"${name}" normally needs singleton sharing.`,
          { package: name },
          undefined,
          findingDetails(FINDING_DETAILS_SCHEMAS.SHARED_SINGLETON, {
            package: name,
            kind: "risk",
          }),
        );
  }),
  createRule("shared/eager-without-singleton", "warning", (context) => {
    for (const [name, shared] of Object.entries(mf(context)?.shared ?? {}))
      if (shared.eager && !shared.singleton)
        report(
          context,
          `"${name}" is eager but not singleton.`,
          { package: name },
          undefined,
          findingDetails(FINDING_DETAILS_SCHEMAS.SHARED_SINGLETON, {
            package: name,
            kind: "eager-without-singleton",
          }),
        );
  }),
  createRule("shared/unused", "warning", (context) => {
    const alwaysShared = alwaysSharedSet(context);
    const unresolvedMayHideUsage = (context.facts.imports.unresolvedDynamic ?? []).some((item) =>
      ["import", "loadShare", "loadShareSync"].includes(item.api),
    );
    // Incomplete dynamic evidence → prefer doctor/partial-analysis over false unused certainty.
    if (unresolvedMayHideUsage) return;
    // MF2 shared-array / shared-inspector manifest-only evidence → prefer partial-analysis.
    if (shouldSkipMf2SharedUnused(context)) return;
    for (const name of Object.keys(mf(context)?.shared ?? {}))
      if (
        !isShareKeyUsed(name, {
          packages: context.facts.imports.packages,
          dynamicPackages: context.facts.imports.dynamicPackages,
          specifiers: context.facts.imports.specifiers,
          deepImports: context.facts.imports.deepImports,
        }) &&
        !alwaysShared.has(name)
      )
        report(
          context,
          `Shared package "${name}" is not imported in scanned sources or opt-in runtime evidence.`,
          {
            package: name,
            evidenceSources: context.facts.imports.evidenceSources ?? [],
            dynamicPackages: context.facts.imports.dynamicPackages ?? [],
            importDepth: context.facts.imports.depth ?? context.sharedPolicy?.importDepth,
          },
          undefined,
          findingDetails(FINDING_DETAILS_SCHEMAS.SHARED_UNUSED, {
            package: name,
            evidenceSources: context.facts.imports.evidenceSources ?? [],
            dynamicPackages: context.facts.imports.dynamicPackages ?? [],
            importDepth: context.facts.imports.depth ?? context.sharedPolicy?.importDepth,
          }),
        );
  }),
  createRule("shared/react-host-missing", "warning", (context) => {
    const imported = new Set([
      ...(context.facts.imports.packages ?? []),
      ...(context.facts.imports.dynamicPackages ?? []),
    ]);
    const missing = reactHostMissingShared(context, imported);
    if (missing.length === 0) return;
    const sharedSnippet = missing
      .map((name) => `${JSON.stringify(name)}: { singleton: true }`)
      .join(", ");
    report(
      context,
      `React host imports ${missing.join(" and ")} but does not declare ${missing.length === 1 ? "it" : "them"} in shared.`,
      {
        role: "host",
        remotes: Object.keys(mf(context)?.remotes ?? {}),
        imports: missing,
        missingShared: missing,
      },
      `Add ${sharedSnippet} to Module Federation shared config, or set rules["shared/react-host-missing"] to "off" when intentional.`,
    );
  }),
  // Package-name heuristic — advisory `info` (strict keeps it from becoming a hard error).
  createRule("shared/candidate", "info", (context) => {
    const shared = new Set(Object.keys(mf(context)?.shared ?? {}));
    const candidates = shareCandidateSet(context);
    const reactHostMissing = new Set(reactHostMissingShared(context));
    for (const name of context.facts.imports.packages)
      if (
        context.facts.dependencies.declared[name] &&
        !shared.has(name) &&
        candidates.has(name) &&
        !reactHostMissing.has(name)
      )
        report(context, `"${name}" is a likely shared dependency.`, {
          package: name,
          importDepth: context.facts.imports.depth ?? context.sharedPolicy?.importDepth,
        });
  }),
  createRule("shared/deep-import-bypass", "warning", (context) => {
    const shared = mf(context)?.shared ?? {};
    const sharedKeys = new Set(Object.keys(shared));
    const allowlist = deepImportAllowlist(context);
    const deepImports = context.facts.imports.deepImports ?? [];
    const deepImportFiles = context.facts.imports.deepImportFiles ?? {};
    const byPackage = new Map<string, string[]>();
    for (const specifier of deepImports) {
      if (allowlist.has(specifier)) continue;
      // Exact shared key for the subpath means MF can negotiate that specifier.
      if (sharedKeys.has(specifier)) continue;
      const root = specifier.startsWith("@")
        ? specifier.split("/").slice(0, 2).join("/")
        : (specifier.split("/")[0] ?? specifier);
      // Bypass only when the root package is shared but the subpath is not.
      if (!sharedKeys.has(root)) continue;
      const list = byPackage.get(root) ?? [];
      list.push(specifier);
      byPackage.set(root, list);
    }
    for (const [pkg, specifiers] of [...byPackage.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      const files = deepImportFiles[pkg] ?? [];
      report(
        context,
        `Shared package "${pkg}" is bypassed by ${specifiers.length} subpath import(s).`,
        {
          package: pkg,
          specifiers: [...specifiers].sort(),
          files: files.slice(0, 5),
          fileCount: files.length,
          importDepth: context.facts.imports.depth ?? context.sharedPolicy?.importDepth,
        },
        `Replace subpath imports with root imports, or add the exact subpaths to shared (for example "${specifiers[0]}").`,
      );
    }
  }),
  createRule("artifact/public-path-suspicious", "warning", (context) => {
    const publicPath = context.facts.artifacts.manifest?.publicPath;
    // Relative `./` (common for Vite/Nuxt) is intentional; flag other opaque relative roots.
    if (publicPath && !/^(auto$|\/|\.\/|https?:\/\/)/.test(publicPath))
      report(
        context,
        `Manifest public path "${publicPath}" may not resolve.`,
        { publicPath },
        undefined,
        findingDetails(FINDING_DETAILS_SCHEMAS.ARTIFACT, { path: publicPath }),
      );
  }),
  createRule("artifact/types-missing", "warning", (context) => {
    if (shouldSkipBridgeEntryDtsGuidance(context)) return;
    const manifest = context.facts.artifacts.manifest;
    if (
      manifest?.valid &&
      manifest.exposes.length > 0 &&
      !context.facts.artifacts.emittedAssets.some((asset) =>
        /(?:\.d\.(ts|mts)|@mf-types\.zip)$/.test(asset),
      )
    )
      report(
        context,
        "No generated federation type files were found.",
        {},
        undefined,
        findingDetails(FINDING_DETAILS_SCHEMAS.ARTIFACT, {}),
      );
  }),
  createRule("bridge/react-version-entry-prefer", "warning", (context) => {
    if (!isReactBridgeProject(context.facts)) return;
    const entry = reactBridgeEntryMajor(context.facts);
    if (entry !== "bare") return;
    const reactMajor = detectedReactMajor(context.facts);
    if (reactMajor === undefined) return;
    const allowed = optionReactMajors(context.options);
    if (allowed && !allowed.includes(reactMajor)) return;
    report(
      context,
      `Prefer "@module-federation/bridge-react/v${reactMajor}" over the bare Bridge React entry when React ${reactMajor} is detected.`,
      { reactMajor, entry: "@module-federation/bridge-react" },
      `Import "@module-federation/bridge-react/v${reactMajor}" (or set rules["bridge/react-version-entry-prefer"] to "off").`,
    );
  }),
  createRule("bridge/react-dom-prefix-missing", "error", (context) => {
    if (!isReactBridgeProject(context.facts)) return;
    if (optionBoolean(context.options, "requireReactDomPrefix") === false) return;
    const entry = reactBridgeEntryMajor(context.facts);
    if (entry !== 18 && entry !== 19) return;
    if (hasReactDomPrefixShare(mf(context)?.shared)) return;
    report(
      context,
      `Bridge React v${entry} requires "react-dom/" (or "react-dom/client") in shared.`,
      {
        entry: `@module-federation/bridge-react/v${entry}`,
        sharedKeys: Object.keys(mf(context)?.shared ?? {}),
      },
      "Add `'react-dom/': { singleton: true }` (or `react-dom/client`) to `shared`, or set `requireReactDomPrefix: false`.",
    );
  }),
  createRule("bridge/lazy-plugin-unregistered", "error", (context) => {
    if (!isReactBridgeProject(context.facts)) return;
    if (optionBoolean(context.options, "requireRuntimePlugin") === false) return;
    if (hasBridgeReactPlugin(mf(context)?.runtimePlugins)) return;
    report(
      context,
      'Bridge React usage is missing "@module-federation/bridge-react/plugin" in runtimePlugins.',
      { runtimePlugins: mf(context)?.runtimePlugins ?? [] },
      'Add "@module-federation/bridge-react/plugin" to `runtimePlugins`, or set `requireRuntimePlugin: false`.',
    );
  }),
  createRule("bridge/router-implicit-enable", "info", (context) => {
    if (!isReactBridgeProject(context.facts)) return;
    if (optionBoolean(context.options, "allowImplicitBridgeRouter") === true) return;
    const options = bridgeOptions(mf(context));
    if (options && typeof options.enableBridgeRouter === "boolean") return;
    report(
      context,
      "`bridge.enableBridgeRouter` is omitted; Rspack may auto-enable Bridge router.",
      { bridge: mf(context)?.bridge ?? null },
      "Set `bridge: { enableBridgeRouter: true }` (or `false`) explicitly, or allow demos with `allowImplicitBridgeRouter: true`.",
    );
  }),
  createRule("bridge/router-shared-conflict", "error", (context) => {
    if (!isReactBridgeProject(context.facts)) return;
    if (!isBridgeRouterEnabled(context.facts)) return;
    const shared = mf(context)?.shared;
    if (!hasSharedReactRouter(shared)) return;
    const keys = sharedReactRouterKeys(shared);
    report(
      context,
      "Bridge router is enabled while React Router is also declared in `shared`, which can duplicate router runtimes.",
      {
        enableBridgeRouter: bridgeOptions(mf(context))?.enableBridgeRouter ?? "implicit",
        sharedRouterKeys: keys,
      },
      "Remove `react-router` / `react-router-dom` from `shared`, or set `bridge.enableBridgeRouter: false` when sharing the router intentionally.",
    );
  }),
  createRule("bridge/react-version-entry-mismatch", "error", (context) => {
    if (!isReactBridgeProject(context.facts)) return;
    const entry = reactBridgeEntryMajor(context.facts);
    if (entry !== 18 && entry !== 19) return;
    const reactMajor = detectedReactMajor(context.facts);
    if (reactMajor === undefined) return;
    const allowed = optionReactMajors(context.options);
    if (allowed && !allowed.includes(reactMajor)) return;
    if (entry === reactMajor) return;
    report(
      context,
      `Bridge React entry "/v${entry}" does not match detected React ${reactMajor}.`,
      {
        entry: `@module-federation/bridge-react/v${entry}`,
        reactMajor,
      },
      `Import "@module-federation/bridge-react/v${reactMajor}" to match React ${reactMajor}, or set \`reactMajors\` / turn the rule \`"off"\`.`,
    );
  }),
  createRule("bridge/provider-shape-invalid", "error", async (context) => {
    if (!isReactBridgeProject(context.facts)) return;
    const root = context.root ?? context.facts.project.root;
    const files = context.facts.imports.sourceFiles ?? [];
    if (files.length === 0) return;
    for (const file of files) {
      let source: string;
      try {
        source = await fs.readFile(path.join(root, file), "utf8");
      } catch {
        continue;
      }
      if (!source.includes("@module-federation/bridge-react")) continue;
      const problem = detectInvalidBridgeProviderShape(source);
      if (!problem) continue;
      report(
        context,
        `Bridge provider/consumer factory looks incomplete (${problem}).`,
        { file, problem },
        "Pass a complete options object to createRemoteAppComponent / createBridgeComponent (loader/module plus root component as needed).",
      );
      return;
    }
  }),
  createRule("bridge/ssr-server-entry-leak", "error", (context) => {
    if (!isReactBridgeProject(context.facts)) return;
    const ssrMode = optionSsrMode(context.options);
    if (!isNodeOrSsrTarget(context.facts, ssrMode)) return;
    if (ssrMode !== "node" && hasBridgeServerEntry(context.facts)) return;
    const leaks = browserBridgeReactEntries(context.facts);
    if (leaks.length === 0) return;
    report(
      context,
      "Browser-only Bridge React entry is referenced from a node/SSR build.",
      {
        entries: leaks,
        ssrMode: ssrMode ?? null,
        experimentsTarget: mf(context)?.experiments?.target ?? null,
        viteTarget: mf(context)?.vite?.target ?? null,
      },
      'Use the Bridge `/server` entry (or a node-safe Bridge import) in SSR/node builds, or set `ssrMode: "browser-only"` when this build is not SSR.',
    );
  }),
  createRule("bridge/missing-fallback-loading", "warning", async (context) => {
    if (!isReactBridgeProject(context.facts)) return;
    const root = context.root ?? context.facts.project.root;
    for (const file of context.facts.imports.sourceFiles ?? []) {
      let source: string;
      try {
        source = await fs.readFile(path.join(root, file), "utf8");
      } catch {
        continue;
      }
      if (!/createRemoteAppComponent\s*\(/.test(source)) continue;
      if (/\bfallback\b/.test(source) && /\bloading\b/.test(source)) continue;
      report(
        context,
        "Bridge createRemoteAppComponent is missing fallback and/or loading UI.",
        { file },
        'Pass `fallback` and `loading` to createRemoteAppComponent, or set the rule to `"off"`.',
      );
      return;
    }
  }),
  createRule("bridge/consumer-api-manual", "warning", async (context) => {
    if (!isReactBridgeProject(context.facts)) return;
    const hasRemotes = Object.keys(mf(context)?.remotes ?? {}).length > 0;
    if (!hasRemotes && (context.facts.imports.remotes?.length ?? 0) === 0) return;
    const root = context.root ?? context.facts.project.root;
    let sawManual = false;
    let sawHelper = false;
    for (const file of context.facts.imports.sourceFiles ?? []) {
      let source: string;
      try {
        source = await fs.readFile(path.join(root, file), "utf8");
      } catch {
        continue;
      }
      if (/\b(?:createRemoteAppComponent|createBridgeComponent|createBridge)\b/.test(source))
        sawHelper = true;
      if (/\bloadRemote\b/.test(source)) sawManual = true;
    }
    if (!sawManual || sawHelper) return;
    report(
      context,
      "React Bridge remotes appear to use manual `loadRemote` instead of Bridge consumer helpers.",
      {
        remotes: Object.keys(mf(context)?.remotes ?? {}),
        importRemotes: context.facts.imports.remotes ?? [],
      },
      'Prefer createRemoteAppComponent / createBridge from `@module-federation/bridge-react`, or set the rule to `"off"`.',
    );
  }),
  createRule("bridge/export-app-missing", "warning", (context) => {
    if (!isReactBridgeProject(context.facts)) return;
    const exposes = mf(context)?.exposes ?? {};
    const keys = Object.keys(exposes);
    if (keys.length === 0) return;
    const hasExportApp = keys.some(
      (key) => key === "./export-app" || key === "export-app" || key.endsWith("/export-app"),
    );
    if (hasExportApp) return;
    report(
      context,
      'Bridge producer exposes modules but is missing the conventional "./export-app" Bridge entry.',
      { exposeKeys: keys },
      'Add `"./export-app"` that returns Bridge `render`/`destroy` (createBridgeComponent), or set the rule to `"off"`.',
    );
  }),
  createRule("bridge/ssr-instanceid-hydration", "info", (context) => {
    if (!isReactBridgeProject(context.facts)) return;
    const ssrMode = optionSsrMode(context.options);
    if (!isNodeOrSsrTarget(context.facts, ssrMode)) return;
    const bridge = mf(context)?.bridge ?? {};
    if (typeof bridge.instanceId === "string" && bridge.instanceId.length > 0) return;
    report(
      context,
      "SSR Bridge builds should set a stable `bridge.instanceId` for hydration registry correlation.",
      { bridge },
      'Set `bridge: { instanceId: "..." }` for SSR hydration, or set `ssrMode: "browser-only"` / the rule to `"off"`.',
    );
  }),
  createRule("bridge/tanstack-router-conflict", "info", (context) => {
    if (!isReactBridgeProject(context.facts)) return;
    if (!isBridgeRouterEnabled(context.facts)) return;
    const signals = [
      ...Object.keys(context.facts.dependencies.declared),
      ...Object.keys(context.facts.dependencies.installed),
      ...(context.facts.imports.packages ?? []),
      ...Object.keys(mf(context)?.shared ?? {}),
    ];
    const tanstack = signals.filter(
      (name) => name === "@tanstack/react-router" || name.startsWith("@tanstack/react-router/"),
    );
    if (tanstack.length === 0) return;
    report(
      context,
      "Bridge router is enabled while `@tanstack/react-router` is also present; routing stacks may conflict.",
      { tanstack },
      'Disable Bridge router or isolate TanStack Router ownership, or set the rule to `"off"`.',
    );
  }),
  createRule("bridge/disable-alias-deprecated", "info", (context) => {
    if (!isReactBridgeProject(context.facts)) return;
    const options = bridgeOptions(mf(context));
    if (options?.disableAlias !== true) return;
    report(
      context,
      "`bridge.disableAlias` is deprecated; prefer an explicit `enableBridgeRouter` setting.",
      { bridge: mf(context)?.bridge ?? null },
      'Replace `disableAlias` with `enableBridgeRouter: false` (or true), or set the rule to `"off"`.',
    );
  }),
  createRule("bridge/vue-share-missing", "error", (context) => {
    if (!isVueBridgeProject(context.facts)) return;
    const shared = mf(context)?.shared ?? {};
    const missing: string[] = [];
    if (!hasSharedPackage(shared, "vue")) missing.push("vue");
    if (usesVueRouter(context.facts) && !hasSharedPackage(shared, "vue-router"))
      missing.push("vue-router");
    if (missing.length === 0) return;
    report(
      context,
      `Vue Bridge projects should share ${missing.map((name) => `\`${name}\``).join(" and ")}.`,
      { missing, sharedKeys: Object.keys(shared) },
      'Add the missing packages to `shared` (singleton recommended), or set the rule to `"off"`.',
    );
  }),
  createRule("bridge/vue-ssr-fresh-context", "warning", async (context) => {
    if (!isVueBridgeProject(context.facts)) return;
    const ssrMode = optionSsrMode(context.options);
    if (
      !isSsrNodeEnvApplicable(context.facts, ssrMode) &&
      !isNodeOrSsrTarget(context.facts, ssrMode)
    )
      return;
    const root = context.root ?? context.facts.project.root;
    const files = context.facts.imports.sourceFiles ?? [];
    if (files.length === 0) return;
    let sawBridge = false;
    let sawFresh = false;
    for (const file of files) {
      let source: string;
      try {
        source = await fs.readFile(path.join(root, file), "utf8");
      } catch {
        continue;
      }
      if (
        !source.includes("@module-federation/bridge-vue3") &&
        !/\bcreateBridgeComponent\b/.test(source)
      )
        continue;
      sawBridge = true;
      if (hasVueBridgeSsrFreshContextHints(source)) sawFresh = true;
    }
    if (!sawBridge || sawFresh) return;
    report(
      context,
      "Vue Bridge SSR builds should create a fresh app/router/store context per request (or use documented hydration helpers).",
      { ssrMode: ssrMode ?? null },
      'Use per-request `createSSRApp` / router / store factories (or `provideBridgeHydrationRegistry` when available), set `ssrMode: "browser-only"` when not SSR, or turn the rule `"off"`.',
    );
  }),
  createRule("bridge/vue-server-entry", "warning", (context) => {
    if (!isVueBridgeProject(context.facts)) return;
    const ssrMode = optionSsrMode(context.options);
    if (
      !isSsrNodeEnvApplicable(context.facts, ssrMode) &&
      !isNodeOrSsrTarget(context.facts, ssrMode)
    )
      return;
    if (hasBridgeVueServerEntry(context.facts)) return;
    report(
      context,
      "Vue Bridge SSR builds should import the Bridge `/server` entry (or documented SSR helpers).",
      {
        ssrMode: ssrMode ?? null,
        entries: [
          ...(context.facts.imports.specifiers ?? []),
          ...(context.facts.imports.deepImports ?? []),
        ].filter((signal) => signal.startsWith("@module-federation/bridge-vue3")),
      },
      'Import `@module-federation/bridge-vue3/server` (or the documented SSR entry) for node builds, set `ssrMode: "browser-only"` when not SSR, or turn the rule `"off"`.',
    );
  }),
  createRule("bridge/vue-consumer-manual", "warning", async (context) => {
    if (!isVueBridgeProject(context.facts)) return;
    const hasRemotes = Object.keys(mf(context)?.remotes ?? {}).length > 0;
    if (!hasRemotes && (context.facts.imports.remotes?.length ?? 0) === 0) return;
    const root = context.root ?? context.facts.project.root;
    let sawManual = false;
    let sawHelper = false;
    for (const file of context.facts.imports.sourceFiles ?? []) {
      let source: string;
      try {
        source = await fs.readFile(path.join(root, file), "utf8");
      } catch {
        continue;
      }
      if (/\b(?:createRemoteAppComponent|createBridgeComponent)\b/.test(source)) sawHelper = true;
      if (/\bloadRemote\b/.test(source)) sawManual = true;
    }
    if (!sawManual || sawHelper) return;
    report(
      context,
      "Vue Bridge remotes appear to use manual `loadRemote` instead of Bridge consumer helpers.",
      {
        remotes: Object.keys(mf(context)?.remotes ?? {}),
        importRemotes: context.facts.imports.remotes ?? [],
      },
      'Prefer createRemoteAppComponent from `@module-federation/bridge-vue3`, or set the rule to `"off"`.',
    );
  }),
  createRule("ssr/node-remote-manifest", "error", (context) => {
    const ssrMode = optionSsrMode(context.options);
    if (!isSsrNodeEnvApplicable(context.facts, ssrMode)) return;
    const remotes = mf(context)?.remotes ?? {};
    const offenders = Object.entries(remotes).filter(
      ([, remote]) =>
        !isMfSsrFragmentRemoteEntry(remote.entry) && isBrowserOnlyManifestRemoteEntry(remote.entry),
    );
    if (offenders.length === 0) return;
    report(
      context,
      "Node/SSR remotes point at a browser `mf-manifest.json` instead of an SSR/env-specific manifest path.",
      {
        remotes: Object.fromEntries(offenders.map(([name, remote]) => [name, remote.entry])),
        ssrMode: ssrMode ?? null,
      },
      'Point node/SSR remotes at `/ssr/mf-manifest.json` (or another env-specific manifest), set `ssrMode: "browser-only"` when not SSR, or turn the rule `"off"`.',
    );
  }),
  createRule("ssr/node-runtime-plugin-missing", "error", (context) => {
    const ssrMode = optionSsrMode(context.options);
    if (!isSsrNodeEnvApplicable(context.facts, ssrMode)) return;
    const runtimePlugins = mf(context)?.runtimePlugins ?? [];
    if (hasNodeRuntimePlugin(runtimePlugins)) return;
    report(
      context,
      `Node/SSR Module Federation builds should include "${NODE_RUNTIME_PLUGIN}" in runtimePlugins.`,
      { runtimePlugins, ssrMode: ssrMode ?? null },
      `Add "${NODE_RUNTIME_PLUGIN}" to \`runtimePlugins\`, set \`ssrMode: "browser-only"\` when not SSR, or turn the rule \`"off"\`.`,
    );
  }),
  createRule("ssr/node-library-dts", "warning", (context) => {
    const ssrMode = optionSsrMode(context.options);
    if (!isSsrNodeEnvApplicable(context.facts, ssrMode)) return;
    const config = mf(context);
    const problems = nodeLibraryDtsProblems(config);
    if (problems.length === 0) return;
    report(
      context,
      "Node/SSR producers should use a commonjs-like `library.type` and typically disable `dts`.",
      {
        problems,
        libraryType: config?.library?.type ?? null,
        dtsEnabled: config?.dts?.enabled ?? null,
        ssrMode: ssrMode ?? null,
      },
      'Set `library: { type: "commonjs-module" }` (or another commonjs-like type) and `dts: false` for node/SSR producers, set `ssrMode: "browser-only"` when not SSR, or turn the rule `"off"`.',
    );
  }),
  createRule("runtime-plugins/invalid-factory", "warning", (context) => {
    for (const item of context.facts.runtimePluginContracts ?? []) {
      if (item.kind !== "invalid-factory") continue;
      const message =
        item.reason === "missing-name"
          ? `Runtime plugin "${item.plugin}" does not expose a usable plugin \`name\` (silent no-op risk).`
          : item.reason === "non-factory-export"
            ? `Runtime plugin "${item.plugin}" default export is not a plugin factory.`
            : `Runtime plugin "${item.plugin}" does not export a usable plugin factory.`;
      report(
        context,
        message,
        {
          plugin: item.plugin,
          reason: item.reason,
          ...(item.file ? { file: item.file } : {}),
        },
        "Export a factory (or plugin object) that returns `{ name, ...hooks }`. Suppress via rules when the module is intentionally opaque.",
      );
    }
  }),
  createRule("runtime-plugins/create-script-cors-parity", "warning", (context) => {
    for (const item of context.facts.runtimePluginContracts ?? []) {
      if (item.kind !== "cors-parity" || item.confidence !== "clear") continue;
      const message =
        item.reason === "cors-mismatch"
          ? `Runtime plugin "${item.plugin}" sets CORS on createScript but createLink lacks matching CORS attributes.`
          : `Runtime plugin "${item.plugin}" customizes createScript with CORS but does not define createLink (preload/cache key mismatch risk).`;
      report(
        context,
        message,
        {
          plugin: item.plugin,
          reason: item.reason,
          confidence: item.confidence,
          ...(item.file ? { file: item.file } : {}),
        },
        "Mirror crossorigin/credentials on createLink (and keep fetch credentials consistent). See Module Federation runtime troubleshooting for CORS preload parity.",
      );
    }
  }),
  createRule("runtime-plugins/create-script-without-link", "info", (context) => {
    for (const item of context.facts.runtimePluginContracts ?? []) {
      if (item.kind !== "cors-parity" || item.confidence !== "heuristic") continue;
      report(
        context,
        `Runtime plugin "${item.plugin}" defines createScript without createLink; preload and load cache keys may diverge.`,
        {
          plugin: item.plugin,
          reason: item.reason,
          confidence: item.confidence,
          ...(item.file ? { file: item.file } : {}),
        },
        "Add a matching createLink hook when preloadRemote or link-based loading is used. Suppress via rules when preload is unused.",
      );
    }
  }),
];

function optionReactMajors(options: Record<string, unknown>): Array<18 | 19> | undefined {
  const value = options.reactMajors;
  if (!Array.isArray(value)) return undefined;
  const majors = value.filter((item): item is 18 | 19 => item === 18 || item === 19);
  return majors.length > 0 ? majors : undefined;
}

export const federationRuleMeta = [
  {
    id: "federation/name-conflict",
    severity: "error",
    ...ruleGuidance["federation/name-conflict"]!,
  },
  {
    id: "federation/version-conflict",
    severity: "error",
    ...ruleGuidance["federation/version-conflict"]!,
  },
  {
    id: "federation/share-scope-mismatch",
    severity: "error",
    ...ruleGuidance["federation/share-scope-mismatch"]!,
  },
  {
    id: "federation/share-strategy-mismatch",
    severity: "warning",
    ...ruleGuidance["federation/share-strategy-mismatch"]!,
  },
  {
    id: "federation/circular-remote-graph",
    severity: "warning",
    ...ruleGuidance["federation/circular-remote-graph"]!,
  },
  {
    id: "federation/missing-provider",
    severity: "error",
    ...ruleGuidance["federation/missing-provider"]!,
  },
  {
    id: "federation/host-gaps",
    severity: "warning",
    ...ruleGuidance["federation/host-gaps"]!,
  },
  {
    id: "federation/ghost-shares",
    severity: "info",
    ...ruleGuidance["federation/ghost-shares"]!,
  },
  {
    id: "shared/singleton-mismatch",
    severity: "warning",
    ...ruleGuidance["shared/singleton-mismatch"]!,
  },
  {
    id: "federation/external-runtime-provider-missing",
    severity: "error",
    ...ruleGuidance["federation/external-runtime-provider-missing"]!,
  },
] as const;

export const runtimeRuleMeta = [
  {
    id: "runtime/remote-load-failed",
    severity: "error",
    ...ruleGuidance["runtime/remote-load-failed"]!,
  },
  {
    id: "runtime/init-failed",
    severity: "error",
    ...ruleGuidance["runtime/init-failed"]!,
  },
  {
    id: "runtime/shared-mismatch",
    severity: "error",
    ...ruleGuidance["runtime/shared-mismatch"]!,
  },
  {
    id: "runtime/remote-unknown",
    severity: "warning",
    ...ruleGuidance["runtime/remote-unknown"]!,
  },
  {
    id: "runtime/error-correlated",
    severity: "error",
    ...ruleGuidance["runtime/error-correlated"]!,
  },
] as const;
