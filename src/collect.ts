import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import { packageName, normalizeModuleFederation } from "./normalize.js";
import type { ArtifactFacts, ProjectFacts, ResolvedDoctorOptions } from "./types.js";
import { normalizePath, relativePath } from "./utils.js";

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

async function collectImports(options: ResolvedDoctorOptions): Promise<ProjectFacts["imports"]> {
  const files = (
    await fg(options.include, {
      cwd: options.root,
      ignore: options.exclude,
      onlyFiles: true,
      followSymbolicLinks: false,
    })
  ).map(normalizePath);
  const specifiers = new Set<string>();
  const importPattern =
    /(?:import|export)\s+(?:[\s\S]*?\sfrom\s*)?["']([^"'`]+)["']|import\s*\(\s*["']([^"'`]+)["']\s*\)|require\s*\(\s*["']([^"'`]+)["']\s*\)/g;
  for (const file of files.sort()) {
    const source = await fs.readFile(path.join(options.root, file), "utf8");
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1] ?? match[2] ?? match[3];
      if (specifier) specifiers.add(specifier);
    }
  }
  const sorted = [...specifiers].sort();
  return {
    sourceFiles: files.sort(),
    specifiers: sorted,
    packages: [
      ...new Set(
        sorted.filter((item) => !item.startsWith(".") && !item.startsWith("/")).map(packageName),
      ),
    ].sort(),
  };
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
  const imports = await collectImports(options);
  const artifacts = await collectArtifacts(options.root);
  const normalizedMf =
    normalizeModuleFederation(options.moduleFederation) ??
    (await detectFromManifest(options.root, artifacts.manifest));
  for (const [key, target] of Object.entries(normalizedMf?.exposes ?? {})) {
    const safeTarget = safeConfigSpecifier(options.root, target);
    try {
      await fs.access(path.resolve(options.root, target));
      const safeNormalized = normalizePath(safeTarget);
      if (!imports.sourceFiles.includes(safeNormalized)) imports.sourceFiles.push(safeNormalized);
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
  imports.sourceFiles.sort();
  const installed = await installedVersions(options.root, declared);
  const bundlerPackage = {
    vite: "vite",
    rspack: "@rspack/core",
    rsbuild: "@rsbuild/core",
    webpack: "webpack",
    unknown: "",
  }[options.bundler];
  const bundlerVersion = options.bundlerVersion ?? installed[bundlerPackage];
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
