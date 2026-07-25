import type {
  ModuleFederationConfigLike,
  NormalizedMFConfig,
  NormalizedRemote,
  NormalizedShared,
} from "./types.js";

export function packageName(specifier: string): string {
  if (specifier.startsWith("@")) return specifier.split("/").slice(0, 2).join("/");
  return specifier.split("/")[0] ?? specifier;
}

function strings(value: string | string[] | undefined, fallback = "default"): string[] {
  return [
    ...new Set(value === undefined ? [fallback] : Array.isArray(value) ? value : [value]),
  ].sort();
}

function toggle(value: boolean | Record<string, unknown> | undefined, defaultEnabled: boolean) {
  if (typeof value === "boolean") return { enabled: value, options: {} };
  return { enabled: value === undefined ? defaultEnabled : true, options: value ?? {} };
}

export function normalizeModuleFederation(
  input: ModuleFederationConfigLike | undefined,
): NormalizedMFConfig | undefined {
  if (!input) return undefined;
  const exposes = Object.fromEntries(
    Object.entries(input.exposes ?? {})
      .map(([key, value]) => {
        const target =
          typeof value === "string"
            ? value
            : typeof value.import === "string"
              ? value.import
              : (value.import[0] ?? "");
        return [key, target] as const;
      })
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  const remotes: Record<string, NormalizedRemote> = {};
  for (const [name, value] of Object.entries(input.remotes ?? {}).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (typeof value === "string") {
      remotes[name] = { name, entry: value, shareScope: ["default"] };
      continue;
    }
    const external = Array.isArray(value.external) ? value.external[0] : value.external;
    remotes[name] = {
      name: value.name ?? name,
      entry: value.entry ?? external ?? "",
      shareScope: strings(value.shareScope),
      ...(value.alias ? { alias: value.alias } : {}),
      ...(value.type ? { type: value.type } : {}),
      ...(value.version ? { version: value.version } : {}),
      ...(value.entryGlobalName ? { entryGlobalName: value.entryGlobalName } : {}),
    };
  }
  const shared: Record<string, NormalizedShared> = {};
  if (Array.isArray(input.shared)) {
    for (const name of [...input.shared].sort())
      shared[name] = {
        package: name,
        singleton: false,
        eager: false,
        strictVersion: false,
        shareScope: ["default"],
      };
  } else {
    for (const [name, value] of Object.entries(input.shared ?? {}).sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      const requiredVersion = typeof value === "string" ? value : value.requiredVersion;
      const treeShaking =
        typeof value === "object" && typeof value.treeShaking === "object"
          ? value.treeShaking
          : typeof value === "object" && value.treeShaking
            ? {}
            : undefined;
      shared[name] = {
        package: name,
        singleton: typeof value === "object" && (value.singleton ?? false),
        eager: typeof value === "object" && (value.eager ?? false),
        strictVersion: typeof value === "object" && (value.strictVersion ?? false),
        shareScope: typeof value === "object" ? strings(value.shareScope) : ["default"],
        ...(requiredVersion !== undefined ? { requiredVersion } : {}),
        ...(typeof value === "object" && value.version !== undefined
          ? { version: value.version }
          : {}),
        ...(typeof value === "object" && value.import !== undefined
          ? { import: value.import }
          : {}),
        ...(typeof value === "object" && value.shareKey ? { shareKey: value.shareKey } : {}),
        ...(typeof value === "object" && value.request ? { request: value.request } : {}),
        ...(typeof value === "object" && value.allowNodeModulesSuffixMatch !== undefined
          ? { allowNodeModulesSuffixMatch: value.allowNodeModulesSuffixMatch }
          : {}),
        ...(treeShaking ? { treeShaking } : {}),
      };
    }
  }
  const normalized: NormalizedMFConfig = {
    exposes,
    remotes,
    shared,
    shareScope: strings(input.shareScope),
    runtimePlugins: (input.runtimePlugins ?? []).map((item) =>
      typeof item === "string" ? item : item[0],
    ),
    manifest: toggle(input.manifest, false),
    dev: toggle(input.dev, true),
    dts: toggle(input.dts, true),
    shareStrategy: input.shareStrategy ?? "version-first",
    experiments: {
      asyncStartup: input.experiments?.asyncStartup ?? false,
      externalRuntime: input.experiments?.externalRuntime ?? false,
      provideExternalRuntime: input.experiments?.provideExternalRuntime ?? false,
      ...(input.experiments?.optimization?.disableSnapshot !== undefined
        ? { disableSnapshot: input.experiments.optimization.disableSnapshot }
        : {}),
      ...(input.experiments?.optimization?.disableRemote !== undefined
        ? { disableRemote: input.experiments.optimization.disableRemote }
        : {}),
      ...(input.experiments?.optimization?.disableShared !== undefined
        ? { disableShared: input.experiments.optimization.disableShared }
        : {}),
      ...(input.experiments?.optimization?.target
        ? { target: input.experiments.optimization.target }
        : {}),
    },
    treeShaking: {
      ...(input.injectTreeShakingUsedExports !== undefined
        ? { injectUsedExports: input.injectTreeShakingUsedExports }
        : {}),
      ...(input.treeShakingDir ? { directory: input.treeShakingDir } : {}),
      plugins: [...(input.treeShakingSharedPlugins ?? [])].sort(),
      excludePlugins: [...(input.treeShakingSharedExcludePlugins ?? [])].sort(),
    },
    vite: {
      ...(input.publicPath ? { publicPath: input.publicPath } : {}),
      bundleAllCSS: input.bundleAllCSS ?? false,
      ignoreOrigin: input.ignoreOrigin ?? false,
      ...(input.virtualModuleDir ? { virtualModuleDir: input.virtualModuleDir } : {}),
      ...(input.hostInitInjectLocation
        ? { hostInitInjectLocation: input.hostInitInjectLocation }
        : {}),
      ...(input.moduleParseTimeout !== undefined
        ? { moduleParseTimeout: input.moduleParseTimeout }
        : {}),
      ...(input.moduleParseIdleTimeout !== undefined
        ? { moduleParseIdleTimeout: input.moduleParseIdleTimeout }
        : {}),
      ...(input.varFilename ? { varFilename: input.varFilename } : {}),
      ...(input.target ? { target: input.target } : {}),
      ...(input.disableRemote !== undefined ? { disableRemote: input.disableRemote } : {}),
      ...(input.disableShared !== undefined ? { disableShared: input.disableShared } : {}),
      ...(input.disableSnapshot !== undefined ? { disableSnapshot: input.disableSnapshot } : {}),
      ssrExternals: [...(input.ssrExternals ?? [])].sort(),
    },
  };
  if (input.name !== undefined) normalized.name = input.name;
  if (input.filename !== undefined) normalized.filename = input.filename;
  if (input.library !== undefined) normalized.library = input.library;
  if (input.remoteType !== undefined) normalized.remoteType = input.remoteType;
  if (input.getPublicPath !== undefined) normalized.getPublicPath = input.getPublicPath;
  if (input.implementation !== undefined) normalized.implementation = input.implementation;
  if (input.virtualRuntimeEntry !== undefined)
    normalized.virtualRuntimeEntry = input.virtualRuntimeEntry;
  return normalized;
}
