import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import { packageName, normalizeModuleFederation } from "./normalize.js";
import { isDeepImportSpecifier } from "./shared-policy.js";
import type {
  ArtifactFacts,
  ImportDepth,
  ImportEvidenceSource,
  ImportFacts,
  ProjectFacts,
  ResolvedDoctorOptions,
  UnresolvedDynamicApi,
  UnresolvedDynamicImport,
} from "./types.js";
import { normalizePath, relativePath } from "./utils.js";
import { detectViteLifecycle } from "./vite-lifecycle.js";

interface PackageJson {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

function safeConfigSpecifier(root: string, value: string): string {
  const normalized = normalizePath(value);
  const marker = "/node_modules/";
  const dependencyIndex = normalized.lastIndexOf(marker);
  if (dependencyIndex >= 0) return normalized.slice(dependencyIndex + marker.length);
  if (!path.isAbsolute(value)) return value;
  const relative = relativePath(root, value);
  return relative.startsWith("[external]/") ? relative : `./${relative}`;
}

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function readPackage(root: string): Promise<PackageJson> {
  try {
    return (await readJson(path.join(root, "package.json"))) as PackageJson;
  } catch {
    return {};
  }
}

async function installedVersions(
  root: string,
  dependencies: Record<string, string>,
): Promise<Record<string, string>> {
  const installed: Record<string, string> = {};
  for (const name of Object.keys(dependencies).sort()) {
    try {
      const value = (await readJson(path.join(root, "node_modules", name, "package.json"))) as {
        version?: string;
      };
      if (value.version) installed[name] = value.version;
    } catch {
      // Package can be hoisted or intentionally absent. Partial analysis reports it.
    }
  }
  return installed;
}

interface RawImportScan {
  sourceFiles: string[];
  /** Specifier → whether any reference was dynamic (import()/require/runtime API). */
  specifierDynamic: Map<string, boolean>;
  /**
   * Specifiers observed only via `export … from` (re-exports).
   * Counted in `local-graph` depth; ignored in `direct` depth.
   */
  reexportOnly: Set<string>;
  /** Specifier → files that reference it (any kind). */
  specifierFiles: Map<string, Set<string>>;
  /** Specifiers that come from loadRemote / registerRemotes (always remotes, not packages). */
  remoteSpecifiers: Set<string>;
  unresolvedDynamic: UnresolvedDynamicImport[];
}

const STATIC_IMPORT_FROM = /\bimport\s+(?:type\s+)?(?:[\s\S]*?\sfrom\s*)?["']([^"'`]+)["']/g;
const STATIC_EXPORT_FROM = /\bexport\s+(?:type\s+)?(?:[\s\S]*?\sfrom\s*)["']([^"'`]+)["']/g;
const DYNAMIC_IMPORT_LITERAL = /import\s*\(\s*["']([^"'`]+)["']\s*\)/g;
const REQUIRE_LITERAL = /require\s*\(\s*["']([^"'`]+)["']\s*\)/g;
const LOAD_REMOTE_LITERAL = /\bloadRemote\s*\(\s*["']([^"'`]+)["']\s*\)/g;
const LOAD_SHARE_LITERAL = /\bloadShare(?:Sync)?\s*\(\s*["']([^"'`]+)["']\s*\)/g;
const REGISTER_REMOTES_NAME =
  /\bregisterRemotes\s*\(\s*\[([\s\S]*?)\]\s*(?:,\s*\{[\s\S]*?\})?\s*\)/g;
const REMOTE_NAME_IN_OBJECT = /\b(?:name|alias)\s*:\s*["']([^"'`]+)["']/g;

/** Dynamic call with a non-literal first argument (variable, template, expression). */
const UNRESOLVED_DYNAMIC_CALL =
  /\b(import|loadRemote|loadShare(?:Sync)?|registerRemotes)\s*\(\s*(?!["'])/g;

function recordSpecifier(
  scan: RawImportScan,
  specifier: string,
  dynamic: boolean,
  file: string,
  kind: "import" | "reexport",
): void {
  const hadNonReexport = scan.specifierDynamic.has(specifier) && !scan.reexportOnly.has(specifier);
  scan.specifierDynamic.set(specifier, Boolean(scan.specifierDynamic.get(specifier)) || dynamic);
  let files = scan.specifierFiles.get(specifier);
  if (!files) {
    files = new Set();
    scan.specifierFiles.set(specifier, files);
  }
  files.add(file);
  if (kind === "import") scan.reexportOnly.delete(specifier);
  else if (!hadNonReexport) scan.reexportOnly.add(specifier);
}

function scanSourceImports(source: string, file: string, scan: RawImportScan): void {
  for (const match of source.matchAll(STATIC_IMPORT_FROM))
    if (match[1]) recordSpecifier(scan, match[1], false, file, "import");
  for (const match of source.matchAll(STATIC_EXPORT_FROM))
    if (match[1]) recordSpecifier(scan, match[1], false, file, "reexport");
  for (const match of source.matchAll(DYNAMIC_IMPORT_LITERAL))
    if (match[1]) recordSpecifier(scan, match[1], true, file, "import");
  for (const match of source.matchAll(REQUIRE_LITERAL))
    if (match[1]) recordSpecifier(scan, match[1], true, file, "import");
  for (const match of source.matchAll(LOAD_REMOTE_LITERAL))
    if (match[1]) {
      recordSpecifier(scan, match[1], true, file, "import");
      scan.remoteSpecifiers.add(match[1]);
    }
  for (const match of source.matchAll(LOAD_SHARE_LITERAL))
    if (match[1]) recordSpecifier(scan, match[1], true, file, "import");

  for (const match of source.matchAll(REGISTER_REMOTES_NAME)) {
    const body = match[1] ?? "";
    let foundName = false;
    for (const nameMatch of body.matchAll(REMOTE_NAME_IN_OBJECT)) {
      if (!nameMatch[1]) continue;
      foundName = true;
      recordSpecifier(scan, nameMatch[1], true, file, "import");
      scan.remoteSpecifiers.add(nameMatch[1]);
    }
    if (!foundName) scan.unresolvedDynamic.push({ api: "registerRemotes", file });
  }

  for (const match of source.matchAll(UNRESOLVED_DYNAMIC_CALL)) {
    const apiRaw = match[1] ?? "import";
    const api: UnresolvedDynamicApi =
      apiRaw === "loadShareSync"
        ? "loadShareSync"
        : apiRaw === "loadShare"
          ? "loadShare"
          : apiRaw === "loadRemote"
            ? "loadRemote"
            : apiRaw === "registerRemotes"
              ? "registerRemotes"
              : "import";
    const after = source.slice((match.index ?? 0) + match[0].length);
    // Array-literal registerRemotes is handled by REGISTER_REMOTES_NAME above.
    if (api === "registerRemotes" && /^\s*\[/.test(after)) continue;
    scan.unresolvedDynamic.push({ api, file });
  }
}

async function scanProjectImports(options: ResolvedDoctorOptions): Promise<RawImportScan> {
  const files = (
    await fg(options.include, {
      cwd: options.root,
      ignore: options.exclude,
      onlyFiles: true,
      followSymbolicLinks: false,
    })
  ).map(normalizePath);
  const scan: RawImportScan = {
    sourceFiles: files.sort(),
    specifierDynamic: new Map(),
    reexportOnly: new Set(),
    specifierFiles: new Map(),
    remoteSpecifiers: new Set(),
    unresolvedDynamic: [],
  };
  for (const file of scan.sourceFiles) {
    const source = await fs.readFile(path.join(options.root, file), "utf8");
    scanSourceImports(source, file, scan);
  }
  scan.unresolvedDynamic.sort((a, b) => a.file.localeCompare(b.file) || a.api.localeCompare(b.api));
  return scan;
}

function finalizeImports(input: {
  scan: RawImportScan;
  remoteAliases: Set<string>;
  manifestRemotes: string[];
  runtimePackages: string[];
  runtimeRemotes: string[];
  evidenceSources: Set<ImportEvidenceSource>;
  depth: ImportDepth;
}): ImportFacts {
  const packages = new Set<string>();
  const dynamicPackages = new Set<string>();
  const remotes = new Set<string>(input.manifestRemotes);
  const deepImports = new Set<string>();
  const deepImportFiles = new Map<string, Set<string>>();
  const includeReexports = input.depth === "local-graph";
  const specifiers = [...input.scan.specifierDynamic.keys()]
    .filter((specifier) => includeReexports || !input.scan.reexportOnly.has(specifier))
    .sort();

  for (const specifier of input.scan.remoteSpecifiers) {
    const name = packageName(specifier);
    remotes.add(name);
  }

  for (const specifier of specifiers) {
    if (input.scan.remoteSpecifiers.has(specifier)) continue;
    if (specifier.startsWith(".") || specifier.startsWith("/")) continue;
    const name = packageName(specifier);
    if (input.remoteAliases.has(name) || remotes.has(name)) {
      remotes.add(name);
      continue;
    }
    packages.add(name);
    if (input.scan.specifierDynamic.get(specifier)) dynamicPackages.add(name);
    if (isDeepImportSpecifier(specifier, name)) {
      deepImports.add(specifier);
      let files = deepImportFiles.get(name);
      if (!files) {
        files = new Set();
        deepImportFiles.set(name, files);
      }
      for (const file of input.scan.specifierFiles.get(specifier) ?? []) files.add(file);
    }
  }

  for (const name of input.runtimePackages) {
    packages.add(name);
    dynamicPackages.add(name);
  }
  for (const name of input.runtimeRemotes) remotes.add(name);

  for (const name of Array.from(packages)) {
    if (!input.remoteAliases.has(name)) continue;
    packages.delete(name);
    dynamicPackages.delete(name);
    remotes.add(name);
  }

  const unresolvedDynamic = [
    ...new Map(
      input.scan.unresolvedDynamic.map((item) => [`${item.api}:${item.file}`, item] as const),
    ).values(),
  ].sort((a, b) => a.file.localeCompare(b.file) || a.api.localeCompare(b.api));

  return {
    sourceFiles: [...input.scan.sourceFiles].sort(),
    specifiers,
    packages: [...packages].sort(),
    dynamicPackages: [...dynamicPackages].sort(),
    remotes: [...remotes].sort(),
    unresolvedDynamic,
    evidenceSources: [...input.evidenceSources].sort(),
    depth: input.depth,
    deepImports: [...deepImports].sort(),
    deepImportFiles: Object.fromEntries(
      [...deepImportFiles.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([pkg, files]) => [pkg, [...files].sort()] as const),
    ),
  };
}

async function runtimeTraceHints(
  runtimeTrace: string | undefined,
): Promise<{ packages: string[]; remotes: string[]; used: boolean }> {
  if (!runtimeTrace) return { packages: [], remotes: [], used: false };
  try {
    const parsed = JSON.parse(await fs.readFile(runtimeTrace, "utf8")) as unknown;
    const reports = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object"
        ? Array.isArray((parsed as { reports?: unknown }).reports)
          ? (parsed as { reports: unknown[] }).reports
          : (parsed as { report?: unknown }).report
            ? [(parsed as { report: unknown }).report]
            : [parsed]
        : [];
    const packages = new Set<string>();
    const remotes = new Set<string>();
    let sawTrace = false;
    for (const item of reports) {
      if (!item || typeof item !== "object") continue;
      const report = item as Record<string, unknown>;
      const shared =
        report.shared && typeof report.shared === "object"
          ? (report.shared as Record<string, unknown>)
          : undefined;
      const remote =
        report.remote && typeof report.remote === "object"
          ? (report.remote as Record<string, unknown>)
          : undefined;
      const sharedName =
        (typeof shared?.package === "string" && shared.package) ||
        (typeof shared?.name === "string" && shared.name) ||
        (typeof shared?.pkg === "string" && shared.pkg) ||
        (typeof shared?.shareKey === "string" && shared.shareKey) ||
        undefined;
      if (sharedName) {
        packages.add(sharedName);
        sawTrace = true;
      }
      if (typeof remote?.name === "string" && remote.name) {
        remotes.add(remote.name);
        sawTrace = true;
      }
      if (typeof remote?.alias === "string" && remote.alias) {
        remotes.add(remote.alias);
        sawTrace = true;
      }
      if (
        typeof report.traceId === "string" ||
        report.summary !== undefined ||
        Array.isArray(report.events)
      )
        sawTrace = true;
    }
    return {
      packages: [...packages].sort(),
      remotes: [...remotes].sort(),
      used: sawTrace,
    };
  } catch {
    // Invalid/missing opt-in traces must not break offline check; partial-analysis covers gaps.
    return { packages: [], remotes: [], used: false };
  }
}

function manifestFrom(value: unknown, file: string): NonNullable<ArtifactFacts["manifest"]> {
  if (!value || typeof value !== "object")
    return { path: file, valid: false, exposes: [], shared: [], remotes: [] };
  const data = value as Record<string, unknown>;
  const rawExposes = Array.isArray(data.exposes) ? data.exposes : [];
  const assetStrings = (input: unknown): string[] => {
    if (typeof input === "string") return [input];
    if (Array.isArray(input)) return input.flatMap(assetStrings);
    if (input && typeof input === "object")
      return Object.values(input as Record<string, unknown>).flatMap(assetStrings);
    return [];
  };
  const exposes = rawExposes
    .map((item) => {
      const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const key = String(record.path ?? record.key ?? record.name ?? "");
      const assets = assetStrings(record.assets);
      return { key, assets: assets.sort() };
    })
    .filter((item) => item.key)
    .sort((a, b) => a.key.localeCompare(b.key));
  const rawShared = Array.isArray(data.shared) ? data.shared : [];
  const rawRemotes = Array.isArray(data.remotes) ? data.remotes : [];
  const manifest: NonNullable<ArtifactFacts["manifest"]> = {
    path: file,
    valid:
      !!data.metaData &&
      typeof data.metaData === "object" &&
      Array.isArray(data.exposes) &&
      Array.isArray(data.shared),
    exposes,
    shared: rawShared
      .map((item) => {
        const shared =
          item && typeof item === "object"
            ? (item as Record<string, unknown>)
            : ({ name: item } as Record<string, unknown>);
        const normalized: NonNullable<ArtifactFacts["manifest"]>["shared"][number] = {
          name: String(shared.name ?? ""),
          assets: assetStrings(shared.assets).sort(),
        };
        if (typeof shared.version === "string") normalized.version = shared.version;
        if (typeof shared.requiredVersion === "string")
          normalized.requiredVersion = shared.requiredVersion;
        if (typeof shared.singleton === "boolean") normalized.singleton = shared.singleton;
        return normalized;
      })
      .filter((item) => item.name)
      .sort((a, b) => a.name.localeCompare(b.name)),
    remotes: rawRemotes
      .map((item) => {
        const remote = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
        const name = String(remote.federationContainerName ?? remote.name ?? "");
        const normalized: NonNullable<NonNullable<ArtifactFacts["manifest"]>["remotes"]>[number] = {
          name,
          shareScope:
            typeof remote.shareScope === "string"
              ? [remote.shareScope]
              : Array.isArray(remote.shareScope)
                ? remote.shareScope.map(String).sort()
                : ["default"],
        };
        if (typeof remote.alias === "string") normalized.alias = remote.alias;
        if (typeof remote.entry === "string") normalized.entry = remote.entry;
        if (typeof remote.version === "string") normalized.version = remote.version;
        return normalized;
      })
      .filter((item) => item.name)
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
  const metadata =
    data.metaData && typeof data.metaData === "object"
      ? (data.metaData as Record<string, unknown>)
      : {};
  const publicPath = data.publicPath ?? data.public_path ?? metadata.publicPath;
  if (typeof publicPath === "string") manifest.publicPath = publicPath;
  if (typeof data.id === "string") manifest.id = data.id;
  if (typeof data.name === "string") manifest.name = data.name;
  if (typeof metadata.pluginVersion === "string") manifest.pluginVersion = metadata.pluginVersion;
  const buildInfo =
    metadata.buildInfo && typeof metadata.buildInfo === "object"
      ? (metadata.buildInfo as Record<string, unknown>)
      : {};
  if (typeof buildInfo.buildVersion === "string") manifest.buildVersion = buildInfo.buildVersion;
  const remoteEntry =
    metadata.remoteEntry && typeof metadata.remoteEntry === "object"
      ? (metadata.remoteEntry as Record<string, unknown>)
      : {};
  if (typeof remoteEntry.name === "string")
    manifest.remoteEntry = {
      name: remoteEntry.name,
      path: typeof remoteEntry.path === "string" ? remoteEntry.path : "",
      ...(typeof remoteEntry.type === "string" ? { type: remoteEntry.type } : {}),
    };
  const types =
    metadata.types && typeof metadata.types === "object"
      ? (metadata.types as Record<string, unknown>)
      : {};
  if (
    typeof types.path === "string" ||
    typeof types.zip === "string" ||
    typeof types.api === "string"
  )
    manifest.types = {
      ...(typeof types.path === "string" ? { path: types.path } : {}),
      ...(typeof types.zip === "string" ? { zip: types.zip } : {}),
      ...(typeof types.api === "string" ? { api: types.api } : {}),
    };
  return manifest;
}

async function detectFromManifest(
  root: string,
  artifact: ArtifactFacts["manifest"],
): Promise<ReturnType<typeof normalizeModuleFederation>> {
  if (!artifact?.valid) return undefined;
  try {
    const data = (await readJson(path.join(root, artifact.path))) as Record<string, unknown>;
    const name =
      typeof data.name === "string" ? data.name : typeof data.id === "string" ? data.id : undefined;
    const shared = Array.isArray(data.shared)
      ? data.shared
          .map((item) =>
            typeof item === "string"
              ? item
              : String((item as Record<string, unknown> | undefined)?.name ?? ""),
          )
          .filter(Boolean)
      : [];
    const remotes = Object.fromEntries(
      (Array.isArray(data.remotes) ? data.remotes : [])
        .map((item) => {
          const remote = item as Record<string, unknown>;
          const remoteName = String(remote.alias ?? remote.name ?? "");
          const entry = String(remote.entry ?? "");
          return [remoteName, entry] as const;
        })
        .filter(([remoteName, entry]) => remoteName && entry),
    );
    return normalizeModuleFederation({
      ...(name ? { name } : {}),
      shared,
      remotes,
    });
  } catch {
    return undefined;
  }
}

function manifestAssetNames(manifest: NonNullable<ArtifactFacts["manifest"]>): string[] {
  const names = new Set<string>();
  if (manifest.remoteEntry?.name) names.add(manifest.remoteEntry.name);
  if (manifest.remoteEntry?.path) {
    const joined = normalizePath(
      path.posix.join(manifest.remoteEntry.path, manifest.remoteEntry.name),
    );
    if (joined && joined !== manifest.remoteEntry.name) names.add(joined);
  }
  for (const expose of manifest.exposes) for (const asset of expose.assets) names.add(asset);
  for (const shared of manifest.shared) for (const asset of shared.assets) names.add(asset);
  return [...names];
}

/** Resolve byte sizes for manifest and emitted assets via on-disk `fs.stat`. */
export async function attachAssetSizes(facts: ProjectFacts, root: string): Promise<void> {
  const names = new Set<string>(facts.artifacts.emittedAssets);
  if (facts.artifacts.manifest?.valid)
    for (const name of manifestAssetNames(facts.artifacts.manifest)) names.add(name);
  if (names.size === 0) {
    delete facts.artifacts.assetSizes;
    return;
  }

  const manifestDir = facts.artifacts.manifest?.path
    ? path.dirname(path.join(root, facts.artifacts.manifest.path))
    : root;
  const sizes: Record<string, number> = {};

  for (const name of names) {
    const basename = path.basename(name);
    const candidates = [
      path.join(manifestDir, name),
      path.join(manifestDir, basename),
      path.join(root, name),
      path.join(root, "dist", name),
      path.join(root, "dist", basename),
      path.join(root, "build", name),
      path.join(root, "build", basename),
      ...facts.artifacts.emittedAssets
        .filter(
          (emitted) =>
            emitted === name ||
            emitted.endsWith(`/${basename}`) ||
            path.basename(emitted) === basename,
        )
        .map((emitted) => path.join(root, emitted)),
    ];

    for (const candidate of candidates) {
      try {
        const stat = await fs.stat(candidate);
        if (!stat.isFile()) continue;
        const relative = relativePath(root, candidate);
        sizes[relative] = stat.size;
        sizes[normalizePath(name)] = stat.size;
        sizes[basename] = stat.size;
        break;
      } catch {
        // Missing candidates are expected before a build or for remote-only names.
      }
    }
  }

  if (Object.keys(sizes).length > 0) facts.artifacts.assetSizes = sizes;
  else delete facts.artifacts.assetSizes;
}

/** Look up a sized asset by relative path, listed name, or basename. */
export function lookupAssetSize(
  sizes: Record<string, number> | undefined,
  asset: string,
): number | undefined {
  if (!sizes) return undefined;
  const normalized = normalizePath(asset);
  if (sizes[normalized] !== undefined) return sizes[normalized];
  const basename = path.basename(normalized);
  if (sizes[basename] !== undefined) return sizes[basename];
  for (const [key, bytes] of Object.entries(sizes))
    if (key === normalized || key.endsWith(`/${basename}`) || path.basename(key) === basename)
      return bytes;
  return undefined;
}

export function sumAssetSizes(
  sizes: Record<string, number> | undefined,
  assets: readonly string[],
): number | undefined {
  let total = 0;
  let found = 0;
  for (const asset of assets) {
    const bytes = lookupAssetSize(sizes, asset);
    if (bytes === undefined) continue;
    total += bytes;
    found += 1;
  }
  return found > 0 ? total : undefined;
}

async function collectArtifacts(root: string): Promise<ArtifactFacts> {
  const candidates = await fg(["**/mf-manifest.json", "**/mf-stats.json"], {
    cwd: root,
    ignore: ["**/node_modules/**", "**/.mf/**"],
    onlyFiles: true,
  });
  const artifact: ArtifactFacts = { emittedAssets: [] };
  for (const file of candidates.sort()) {
    const relative = normalizePath(file);
    try {
      const data = await readJson(path.join(root, file));
      if (file.endsWith("mf-manifest.json")) artifact.manifest = manifestFrom(data, relative);
      else artifact.stats = { path: relative, valid: !!data && typeof data === "object" };
    } catch {
      if (file.endsWith("mf-manifest.json"))
        artifact.manifest = {
          path: relative,
          valid: false,
          exposes: [],
          shared: [],
          remotes: [],
        };
      else artifact.stats = { path: relative, valid: false };
    }
  }
  return artifact;
}

export async function collectProjectFacts(options: ResolvedDoctorOptions): Promise<ProjectFacts> {
  const packageJson = await readPackage(options.root);
  const declared = {
    ...packageJson.peerDependencies,
    ...packageJson.devDependencies,
    ...packageJson.dependencies,
  };
  const scan = await scanProjectImports(options);
  const artifacts = await collectArtifacts(options.root);
  const normalizedMf =
    normalizeModuleFederation(options.moduleFederation) ??
    (await detectFromManifest(options.root, artifacts.manifest));
  for (const [key, target] of Object.entries(normalizedMf?.exposes ?? {})) {
    const safeTarget = safeConfigSpecifier(options.root, target);
    try {
      await fs.access(path.resolve(options.root, target));
      const safeNormalized = normalizePath(safeTarget);
      if (!scan.sourceFiles.includes(safeNormalized)) scan.sourceFiles.push(safeNormalized);
    } catch {
      // Missing expose paths are reported from this collected absence.
    }
    normalizedMf!.exposes[key] = safeTarget;
  }
  if (normalizedMf?.runtimePlugins)
    normalizedMf.runtimePlugins = normalizedMf.runtimePlugins.map((plugin) =>
      safeConfigSpecifier(options.root, plugin),
    );
  if (normalizedMf?.implementation)
    normalizedMf.implementation = safeConfigSpecifier(options.root, normalizedMf.implementation);
  if (normalizedMf?.treeShaking?.directory)
    normalizedMf.treeShaking.directory = safeConfigSpecifier(
      options.root,
      normalizedMf.treeShaking.directory,
    );
  if (normalizedMf?.vite?.virtualModuleDir)
    normalizedMf.vite.virtualModuleDir = safeConfigSpecifier(
      options.root,
      normalizedMf.vite.virtualModuleDir,
    );
  scan.sourceFiles.sort();

  const remoteAliases = new Set(
    Object.entries(normalizedMf?.remotes ?? {}).flatMap(([alias, remote]) =>
      [alias, remote.name, remote.alias].filter((value): value is string => Boolean(value)),
    ),
  );
  const manifestRemotes = (artifacts.manifest?.remotes ?? [])
    .flatMap((remote) => [remote.name, remote.alias])
    .filter((value): value is string => Boolean(value));
  const traceHints = await runtimeTraceHints(options.runtimeTrace);
  const evidenceSources = new Set<ImportEvidenceSource>();
  if (scan.sourceFiles.length > 0 || scan.specifierDynamic.size > 0) evidenceSources.add("source");
  if (manifestRemotes.length > 0) evidenceSources.add("manifest");
  if (traceHints.used) evidenceSources.add("runtime-trace");

  const imports = finalizeImports({
    scan,
    remoteAliases,
    manifestRemotes,
    runtimePackages: traceHints.packages,
    runtimeRemotes: traceHints.remotes,
    evidenceSources,
    depth: options.sharedPolicy.importDepth,
  });

  const installed = await installedVersions(options.root, declared);
  const bundlerPackage = {
    vite: "vite",
    rspack: "@rspack/core",
    rsbuild: "@rsbuild/core",
    webpack: "webpack",
    modern: "@modern-js/app-tools",
    unknown: "",
  }[options.bundler];
  const bundlerVersion = bundlerPackage
    ? (options.bundlerVersion ?? installed[bundlerPackage])
    : options.bundlerVersion;
  const lifecycle =
    options.bundler === "vite"
      ? (options.viteLifecycle ?? (await detectViteLifecycle(options.root)))
      : undefined;
  const facts: ProjectFacts = {
    schemaVersion: 1,
    project: {
      name: packageJson.name ?? path.basename(options.root),
      root: ".",
    },
    bundler: {
      name: options.bundler,
      mode: options.mode,
      ...(bundlerVersion ? { version: bundlerVersion } : {}),
      ...(lifecycle ? { lifecycle } : {}),
    },
    capabilities: {
      config: options.moduleFederation !== undefined,
      sourceImports: true,
      manifest: artifacts.manifest !== undefined,
      stats: artifacts.stats !== undefined,
      emittedAssets: false,
      installedVersions: true,
    },
    dependencies: {
      declared: Object.fromEntries(Object.entries(declared).sort(([a], [b]) => a.localeCompare(b))),
      installed,
    },
    imports,
    artifacts,
  };
  if (normalizedMf) facts.moduleFederation = normalizedMf;
  await attachAssetSizes(facts, options.root);
  return facts;
}

export async function addBuildFacts(
  facts: ProjectFacts,
  assets: string[],
  root: string,
): Promise<ProjectFacts> {
  facts.artifacts.emittedAssets = assets
    .map((item) => relativePath(root, path.resolve(root, item)))
    .sort();
  facts.capabilities.emittedAssets = true;
  await attachAssetSizes(facts, root);
  return facts;
}
