import semver from "semver";

export type CapabilityVersionSelector = "unknown" | string;

export type CapabilityStatus = "supported" | "unsupported" | "ignored" | "transformed" | "unknown";

export interface CapabilityField {
  status: CapabilityStatus;
  acceptedForms: readonly string[];
}

export interface CapabilityPackProvenance {
  source: string;
  commit: string;
  package: string;
  version: string;
  reviewedFiles: readonly string[];
}

export interface CapabilityPack {
  id: string;
  provenance?: CapabilityPackProvenance;
  core: {
    name: string;
    version: CapabilityVersionSelector;
  };
  adapter: {
    name: string;
    version: CapabilityVersionSelector;
  };
  bundler: {
    name: string;
    version: CapabilityVersionSelector;
  };
  target: string;
  mode?: string;
  fields: Readonly<Record<string, CapabilityField>>;
}

const supported = (acceptedForms: readonly string[]): CapabilityField => ({
  status: "supported",
  acceptedForms,
});

/**
 * The first reviewed Enhanced Webpack contract slice. This is deliberately
 * descriptive: it does not add defaults, mutate config, or imply collection.
 */
export const ENHANCED_WEBPACK_V5_BROWSER_PACK: CapabilityPack = {
  id: "enhanced-webpack-v5-browser",
  provenance: {
    source: "module-federation/core@d927242",
    commit: "d927242",
    package: "@module-federation/sdk",
    version: "2.7.0",
    reviewedFiles: ["packages/sdk/src/types/plugins/ModuleFederationPlugin.ts"],
  },
  core: { name: "@module-federation/sdk", version: ">=2.7.0 <2.8.0" },
  adapter: { name: "@module-federation/enhanced", version: ">=2.7.0 <2.8.0" },
  bundler: { name: "webpack", version: ">=5 <6" },
  target: "browser",
  fields: {
    exposes: supported(["string", "object", "array", "outer-array"]),
    remotes: supported(["string", "object", "array", "outer-array"]),
    "remotes.external": supported(["string", "array"]),
    "remotes.shareScope": supported(["string", "array"]),
    shared: supported(["string", "object", "array", "outer-array"]),
    "shared.import": supported(["false", "string"]),
    "shared.requiredVersion": supported(["false", "string"]),
    "shared.version": supported(["false", "string"]),
    "shared.shareScope": supported(["string", "array"]),
    "shared.treeShaking": supported(["boolean", "object"]),
    runtimePlugins: supported(["string", "tuple"]),
    manifest: supported(["boolean", "object"]),
    dev: supported(["boolean", "object"]),
    dts: supported(["boolean", "object"]),
    experiments: supported(["object"]),
    bridge: supported(["object"]),
    async: supported(["boolean", "object"]),
    treeShaking: supported(["boolean", "object"]),
    treeShakingDir: supported(["string"]),
    injectTreeShakingUsedExports: supported(["boolean"]),
    treeShakingSharedExcludePlugins: supported(["array"]),
    treeShakingSharedPlugins: supported(["array"]),
  },
};

export const BUILT_IN_CAPABILITY_PACKS: readonly CapabilityPack[] = [
  ENHANCED_WEBPACK_V5_BROWSER_PACK,
];

export interface CapabilityQuery {
  core: {
    name: string;
    version?: string;
  };
  adapter: {
    name: string;
    version?: string;
  };
  bundler: {
    name: string;
    version?: string;
  };
  target: string;
  mode?: string;
}

export type CapabilityResolution =
  | {
      status: "matched";
      pack: CapabilityPack;
    }
  | {
      status: "ambiguous";
      candidates: readonly string[];
    }
  | {
      status: "unknown";
      reason: "no-match" | "missing-version";
      candidates: readonly string[];
    };

export interface ResolvedCapability {
  status: CapabilityStatus;
  acceptedForms: readonly string[];
}

function selectorMatches(
  selector: CapabilityVersionSelector,
  version: string | undefined,
): boolean {
  if (selector === "unknown") return version === undefined || version === "unknown";
  if (version === undefined || version === "unknown") return false;
  return semver.valid(version) !== null && semver.validRange(selector) !== null
    ? semver.satisfies(version, selector, { includePrerelease: true })
    : false;
}

function dimensionsMatch(pack: CapabilityPack, query: CapabilityQuery): boolean {
  return (
    pack.core.name === query.core.name &&
    pack.adapter.name === query.adapter.name &&
    pack.bundler.name === query.bundler.name &&
    pack.target === query.target &&
    (pack.mode === undefined || pack.mode === query.mode)
  );
}

function versionRangeIsValid(selector: CapabilityVersionSelector): boolean {
  return selector === "unknown" || semver.validRange(selector) !== null;
}

/** Validate pack metadata before it can influence capability queries. */
export function assertCapabilityPacks(packs: readonly CapabilityPack[]): void {
  const ids = new Set<string>();
  for (const pack of packs) {
    if (!pack.id || ids.has(pack.id))
      throw new TypeError(`Capability pack id is not unique: ${pack.id}`);
    ids.add(pack.id);
    if (
      !versionRangeIsValid(pack.core.version) ||
      !versionRangeIsValid(pack.adapter.version) ||
      !versionRangeIsValid(pack.bundler.version)
    ) {
      throw new TypeError(`Capability pack ${pack.id} has an invalid version selector.`);
    }
  }
}

/** Resolve one exact adapter/bundler/target capability pack without applying defaults. */
export function resolveCapabilityPack(
  query: CapabilityQuery,
  packs: readonly CapabilityPack[],
): CapabilityResolution {
  assertCapabilityPacks(packs);
  const dimensional = packs.filter((pack) => dimensionsMatch(pack, query));
  const matches = dimensional.filter(
    (pack) =>
      selectorMatches(pack.core.version, query.core.version) &&
      selectorMatches(pack.adapter.version, query.adapter.version) &&
      selectorMatches(pack.bundler.version, query.bundler.version),
  );
  if (matches.length === 1) return { status: "matched", pack: matches[0]! };
  if (matches.length > 1)
    return { status: "ambiguous", candidates: matches.map((pack) => pack.id).sort() };
  return {
    status: "unknown",
    reason:
      dimensional.length > 0 &&
      [query.core.version, query.adapter.version, query.bundler.version].some(
        (version) => version === undefined || version === "unknown",
      )
        ? "missing-version"
        : "no-match",
    candidates: dimensional.map((pack) => pack.id).sort(),
  };
}

/** Query a field while keeping an unresolved pack or field explicitly unknown. */
export function queryCapability(
  resolution: CapabilityResolution,
  field: string,
): ResolvedCapability {
  if (resolution.status !== "matched") return { status: "unknown", acceptedForms: [] };
  return Object.prototype.hasOwnProperty.call(resolution.pack.fields, field)
    ? resolution.pack.fields[field]!
    : { status: "unknown", acceptedForms: [] };
}
