import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import { parseSync, visitorKeys } from "oxc-parser";
import { packageName, normalizeModuleFederation } from "./normalize.js";
import { isDeepImportSpecifier } from "./shared-policy.js";
import type {
  ArtifactKind,
  ArtifactManifest,
  ArtifactRecord,
  ArtifactStats,
  ArtifactFacts,
  BuildRecord,
  ViteBuildOutputInput,
  ImportDepth,
  ImportEvidenceSource,
  ImportFacts,
  OutputPublicPathKind,
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

const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_AST_NODES = 100_000;

type AstNode = {
  type?: string;
  [key: string]: unknown;
};

const DYNAMIC_APIS = new Set<UnresolvedDynamicApi>([
  "import",
  "loadRemote",
  "loadShare",
  "loadShareSync",
  "registerRemotes",
]);

function parserLanguage(file: string): "js" | "jsx" | "ts" | "tsx" | "dts" {
  const normalized = file.toLowerCase();
  if (normalized.endsWith(".d.ts")) return "dts";
  if (normalized.endsWith(".tsx")) return "tsx";
  if (normalized.endsWith(".jsx")) return "jsx";
  if (normalized.endsWith(".ts")) return "ts";
  return "js";
}

function literalString(node: unknown): string | undefined {
  if (!node || typeof node !== "object") return undefined;
  const value = (node as { type?: string; value?: unknown }).value;
  return (node as { type?: string }).type === "Literal" && typeof value === "string"
    ? value
    : undefined;
}

function identifierName(node: unknown): string | undefined {
  if (!node || typeof node !== "object") return undefined;
  const value = node as { type?: string; name?: unknown };
  return value.type === "Identifier" && typeof value.name === "string" ? value.name : undefined;
}

function propertyName(node: unknown): string | undefined {
  if (!node || typeof node !== "object") return undefined;
  const value = node as { computed?: unknown; key?: unknown };
  if (value.computed) return literalString(value.key);
  return identifierName(value.key) ?? literalString(value.key);
}

/** Keep source parsing and AST traversal bounded for untrusted project files. */
function walkAst(program: AstNode, visit: (node: AstNode) => void): void {
  let count = 0;
  const visitNode = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const value = node as AstNode;
    if (typeof value.type !== "string") return;
    count += 1;
    if (count > MAX_AST_NODES) throw new Error("AST node limit exceeded");
    visit(value);
    for (const key of visitorKeys[value.type] ?? []) {
      const child = value[key];
      if (Array.isArray(child)) for (const item of child) visitNode(item);
      else visitNode(child);
    }
  };
  visitNode(program);
}

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
  const unresolved = (api: UnresolvedDynamicApi): void => {
    scan.unresolvedDynamic.push({ api, file });
  };

  if (Buffer.byteLength(source, "utf8") > MAX_SOURCE_BYTES) {
    unresolved("import");
    return;
  }

  try {
    const parsed = parseSync(file, source, {
      lang: parserLanguage(file),
      sourceType: "unambiguous",
    });
    if (parsed.errors.length > 0) {
      unresolved("import");
      return;
    }

    walkAst(parsed.program as unknown as AstNode, (node) => {
      if (node.type === "ImportDeclaration" || node.type === "ExportNamedDeclaration") {
        const specifier = literalString(node.source);
        if (specifier)
          recordSpecifier(
            scan,
            specifier,
            false,
            file,
            node.type === "ImportDeclaration" ? "import" : "reexport",
          );
        return;
      }
      if (node.type === "ExportAllDeclaration") {
        const specifier = literalString(node.source);
        if (specifier) recordSpecifier(scan, specifier, false, file, "reexport");
        return;
      }
      if (node.type === "ImportExpression") {
        const specifier = literalString(node.source);
        if (specifier) recordSpecifier(scan, specifier, true, file, "import");
        else unresolved("import");
        return;
      }
      if (node.type !== "CallExpression") return;

      const apiName = identifierName(node.callee);
      if (!apiName || !DYNAMIC_APIS.has(apiName as UnresolvedDynamicApi)) return;
      const api = apiName as UnresolvedDynamicApi;
      const args = Array.isArray(node.arguments) ? node.arguments : [];
      const specifier = literalString(args[0]);
      if (api === "registerRemotes") {
        let foundName = false;
        const first = args[0] as AstNode | undefined;
        const entries =
          first?.type === "ArrayExpression" && Array.isArray(first.elements) ? first.elements : [];
        for (const entry of entries) {
          if (!entry || typeof entry !== "object" || (entry as AstNode).type !== "ObjectExpression")
            continue;
          const rawProperties = (entry as AstNode).properties;
          const properties: unknown[] = Array.isArray(rawProperties) ? rawProperties : [];
          for (const property of properties) {
            if (!property || typeof property !== "object") continue;
            const item = property as AstNode;
            const name = propertyName(item);
            if ((name === "name" || name === "alias") && literalString(item.value)) {
              const remote = literalString(item.value)!;
              foundName = true;
              recordSpecifier(scan, remote, true, file, "import");
              scan.remoteSpecifiers.add(remote);
            }
          }
        }
        if (!foundName) unresolved(api);
        return;
      }
      if (!specifier) {
        unresolved(api);
        return;
      }
      recordSpecifier(scan, specifier, true, file, "import");
      if (api === "loadRemote") scan.remoteSpecifiers.add(specifier);
    });
  } catch {
    // A bounded parser failure is incomplete evidence, never a confident import result.
    unresolved("import");
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
    const { loadRuntimeTraceFile } = await import("./runtime-trace.js");
    const reports = await loadRuntimeTraceFile(runtimeTrace);
    const packages = new Set<string>();
    const remotes = new Set<string>();
    let sawTrace = false;
    for (const item of reports) {
      const shared = item.shared;
      const remote = item.remote;
      const sharedName = shared?.package;
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
      sawTrace = true;
    }
    return {
      packages: [...packages].sort(),
      remotes: [...remotes].sort(),
      used: sawTrace,
    };
  } catch {
    // Opt-in runtimeTrace must use the same adapter as `mfdoctor runtime`, but
    // invalid/missing traces must not break offline check; partial-analysis covers gaps.
    return { packages: [], remotes: [], used: false };
  }
}

function manifestFrom(value: unknown, file: string): ArtifactManifest {
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
export async function attachAssetSizes(
  facts: ProjectFacts,
  root: string,
  outputRoots?: readonly string[],
): Promise<void> {
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
    const normalizedName = normalizePath(name);
    const basename = path.basename(normalizedName);
    const candidates =
      outputRoots !== undefined
        ? outputRoots.flatMap((outputRoot) => {
            const normalizedRoot = normalizePath(outputRoot);
            if (
              normalizedName === normalizedRoot ||
              normalizedName.startsWith(`${normalizedRoot}/`)
            )
              return [path.join(root, name)];
            return [path.join(root, outputRoot, name)];
          })
        : [
            path.join(manifestDir, name),
            path.join(manifestDir, basename),
            path.join(root, name),
            path.join(root, "dist", name),
            path.join(root, "dist", basename),
            path.join(root, "build", name),
            path.join(root, "build", basename),
            ...facts.artifacts.emittedAssets
              .filter((emitted) => emitted === name)
              .map((emitted) => path.join(root, emitted)),
          ];

    for (const candidate of candidates) {
      try {
        const stat = await fs.stat(candidate);
        if (!stat.isFile()) continue;
        const relative = relativePath(root, candidate);
        sizes[relative] = stat.size;
        if (outputRoots === undefined || outputRoots.length === 1) {
          sizes[normalizedName] = stat.size;
          sizes[basename] = stat.size;
        }
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

async function collectArtifacts(
  root: string,
  names: ResolvedDoctorOptions["artifactNames"],
  boundedRoots?: string[],
): Promise<ArtifactFacts> {
  const validateName = (name: string): string => {
    if (!name || path.isAbsolute(name) || path.win32.isAbsolute(name) || /^[A-Za-z]:/.test(name))
      throw new Error(`Artifact name must be a safe literal relative path: ${name}`);
    const normalized = normalizePath(name).replace(/^\.\//, "");
    if (!normalized || normalized.split("/").some((part) => part === ".."))
      throw new Error(`Artifact name must stay inside the project root: ${name}`);
    return normalized;
  };
  const manifestNames = names.manifest.map(validateName);
  const statsNames = names.stats.map(validateName);
  const rootReal = await fs.realpath(root);
  const allNames = [...manifestNames, ...statsNames];
  const patterns =
    boundedRoots !== undefined
      ? boundedRoots.flatMap((outputRoot) =>
          allNames.map((name) => fg.escapePath(normalizePath(path.posix.join(outputRoot, name)))),
        )
      : allNames.map((name) =>
          name.includes("/") ? fg.escapePath(name) : `**/${fg.escapePath(name)}`,
        );
  const candidates = await fg([...new Set(patterns)], {
    cwd: root,
    ignore: ["**/node_modules/**", "**/.mf/**"],
    onlyFiles: true,
    dot: true,
    followSymbolicLinks: false,
  });
  const kindsFor = (file: string): ArtifactKind[] => {
    const normalized = normalizePath(file);
    const basename = path.posix.basename(normalized);
    const matches = (name: string): boolean =>
      normalized === name ||
      (!name.includes("/") && basename === name) ||
      Boolean(boundedRoots?.some((rootName) => normalized === path.posix.join(rootName, name)));
    return [
      ...(manifestNames.some(matches) ? (["manifest"] as const) : []),
      ...(statsNames.some(matches) ? (["stats"] as const) : []),
    ];
  };
  const records: ArtifactRecord[] = [];
  const artifact: ArtifactFacts = { records, emittedAssets: [] };
  for (const file of candidates.sort()) {
    const relative = normalizePath(file);
    const kinds = kindsFor(relative);
    if (kinds.length === 0) continue;
    const real = await fs.realpath(path.join(root, file)).catch(() => undefined);
    if (!real || (path.relative(rootReal, real) || ".").startsWith("..")) continue;
    let data: unknown;
    try {
      data = await readJson(path.join(root, file));
    } catch {
      data = undefined;
    }
    for (const kind of kinds) {
      if (kind === "manifest") {
        const manifest = manifestFrom(data, relative);
        records.push({
          kind,
          path: relative,
          valid: manifest.valid,
          state: manifest.valid ? "valid" : "malformed",
          source: "discovered",
          manifest,
        });
      } else {
        const valid = !!data && typeof data === "object" && !Array.isArray(data);
        const stats: ArtifactStats = {
          path: relative,
          valid,
          ...(valid ? { data: data as Record<string, unknown> } : {}),
        };
        records.push({
          kind,
          path: relative,
          valid,
          state: valid ? "valid" : "malformed",
          source: "discovered",
          stats,
        });
      }
    }
  }
  records.sort((left, right) =>
    `${left.kind}:${left.path}`.localeCompare(`${right.kind}:${right.path}`),
  );
  const firstManifest = records.find((record) => record.kind === "manifest")?.manifest;
  const firstStats = records.find((record) => record.kind === "stats")?.stats;
  if (firstManifest) artifact.manifest = firstManifest;
  if (firstStats) artifact.stats = firstStats;
  return artifact;
}

export async function collectProjectFacts(
  options: ResolvedDoctorOptions,
  boundedRoots?: string[],
): Promise<ProjectFacts> {
  const packageJson = await readPackage(options.root);
  const declared = {
    ...packageJson.peerDependencies,
    ...packageJson.devDependencies,
    ...packageJson.dependencies,
  };
  const scan = await scanProjectImports(options);
  const artifacts = await collectArtifacts(options.root, options.artifactNames, boundedRoots);
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

export interface BuildDiagnostics {
  moduleFederationPluginCount?: number;
  outputPublicPathKind?: OutputPublicPathKind;
}

export async function addBuildFacts(
  facts: ProjectFacts,
  assets: string[],
  root: string,
  diagnostics?: BuildDiagnostics,
  outputs?: ViteBuildOutputInput[],
): Promise<ProjectFacts> {
  facts.artifacts.emittedAssets = assets
    .map((item) => relativePath(root, path.resolve(root, item)))
    .sort();
  facts.capabilities.emittedAssets = true;
  if (diagnostics?.moduleFederationPluginCount !== undefined)
    facts.bundler.moduleFederationPluginCount = diagnostics.moduleFederationPluginCount;
  if (diagnostics?.outputPublicPathKind)
    facts.bundler.outputPublicPathKind = diagnostics.outputPublicPathKind;
  if (outputs) {
    const orderedOutputs = outputs
      .slice()
      .sort((left, right) =>
        `${left.outputRoot ?? ""}:${left.emittedAssets.join(",")}:${left.sourceHook}`.localeCompare(
          `${right.outputRoot ?? ""}:${right.emittedAssets.join(",")}:${right.sourceHook}`,
        ),
      );
    const builds: BuildRecord[] = orderedOutputs.map((output, index) => {
      const id = `vite-build-${index + 1}`;
      const outputRoot = output.outputRoot
        ? relativePath(root, path.resolve(root, output.outputRoot))
        : undefined;
      const emittedAssets = (output.buildWrite === false ? [] : output.emittedAssets)
        .map((asset) =>
          outputRoot ? normalizePath(path.posix.join(outputRoot, asset)) : normalizePath(asset),
        )
        .sort();
      const artifactRecords: ArtifactRecord[] = [];
      for (const record of facts.artifacts.records ?? []) {
        const belongsToOutput = (() => {
          if (!outputRoot || output.buildWrite === false) return false;
          if (
            outputRoot !== "." &&
            record.path !== outputRoot &&
            !record.path.startsWith(`${outputRoot}/`)
          )
            return false;
          const relativeArtifact =
            outputRoot === "." ? record.path : record.path.slice(`${outputRoot}/`.length);
          return output.emittedAssets.some((asset) => normalizePath(asset) === relativeArtifact);
        })();
        if (belongsToOutput)
          artifactRecords.push(
            Object.assign({}, record, { source: "emitted" as const, buildId: id }),
          );
      }
      const outputRootCapability = output.outputRoot
        ? {
            state: "exact" as const,
            reason: "Resolved Vite output root was public.",
            source: "configResolved",
          }
        : {
            state: "unavailable" as const,
            reason: "Vite did not expose an output root.",
            source: output.sourceHook,
          };
      const emittedCapability =
        output.buildWrite === false
          ? {
              state: "not-applicable" as const,
              reason: "Vite build.write was false; no files were written.",
              source: "configResolved",
            }
          : output.emittedAssets.length > 0
            ? {
                state: "exact" as const,
                reason: "Asset names came from the public bundle.",
                source: "writeBundle",
              }
            : {
                state: "partial" as const,
                reason: "The public bundle contained no asset names.",
                source: output.sourceHook,
              };
      const artifactCapability =
        output.buildWrite === false
          ? {
              state: "not-applicable" as const,
              reason: "Artifacts cannot be emitted when build.write is false.",
              source: "configResolved",
            }
          : {
              state: artifactRecords.length > 0 ? ("exact" as const) : ("partial" as const),
              reason:
                artifactRecords.length > 0
                  ? "Artifacts matched inside this output root."
                  : "No configured artifact was found in this output.",
              source: output.sourceHook,
            };
      const modeCapability = output.effectiveMode
        ? {
            state: "exact" as const,
            reason: "Effective mode came from resolved Vite config.",
            source: "configResolved",
          }
        : {
            state: "unavailable" as const,
            reason: "Vite did not expose an effective build mode.",
            source: "configResolved",
          };
      const targetCapability =
        output.target || output.targetKind
          ? {
              state: "exact" as const,
              reason: "Target came from public Vite config.",
              source: "configResolved",
            }
          : {
              state: "unavailable" as const,
              reason: "Vite did not expose a target.",
              source: "configResolved",
            };
      const build: BuildRecord = {
        id,
        adapter: "vite",
        bundler: "vite",
        emittedAssets,
        artifacts: artifactRecords,
        capabilities: {
          outputRoot: outputRootCapability,
          emittedAssets: emittedCapability,
          artifacts: artifactCapability,
          effectiveMode: modeCapability,
          target: targetCapability,
        },
        sourceHook: output.sourceHook,
      };
      if (output.flavor) build.flavor = output.flavor;
      if (output.engine) build.engine = output.engine;
      if (outputRoot) build.outputRoot = outputRoot;
      if (output.effectiveMode) build.effectiveMode = output.effectiveMode;
      if (output.target) build.target = output.target;
      if (output.targetKind) build.targetKind = output.targetKind;
      return build;
    });
    facts.builds = builds.sort((a, b) => a.id.localeCompare(b.id));
    // Compatibility view: deterministic primary-build projection.
    facts.artifacts.emittedAssets = [
      ...new Set(builds.flatMap((build) => build.emittedAssets)),
    ].sort();
    facts.capabilities.emittedAssets =
      builds.length > 0 &&
      builds.every((build) => build.capabilities.emittedAssets.state === "exact");
    const currentRecords = builds.flatMap((build) => build.artifacts);
    const firstCurrent = (kind: ArtifactKind) => {
      const records = currentRecords
        .filter((record) => record.kind === kind)
        .sort((left, right) => left.path.localeCompare(right.path));
      // Prefer malformed current evidence so a valid artifact from another
      // output cannot hide a broken artifact from this build cycle.
      return records.find((record) => !record.valid) ?? records[0];
    };
    const currentManifest = firstCurrent("manifest")?.manifest;
    const currentStats = firstCurrent("stats")?.stats;
    if (currentManifest) facts.artifacts.manifest = currentManifest;
    else delete facts.artifacts.manifest;
    if (currentStats) facts.artifacts.stats = currentStats;
    else delete facts.artifacts.stats;
  }
  const recordedOutputRoots = facts.builds
    ?.filter((build) => build.capabilities.emittedAssets.state !== "not-applicable")
    .map((build) => build.outputRoot)
    .filter((value): value is string => Boolean(value));
  await attachAssetSizes(facts, root, recordedOutputRoots);
  return facts;
}
