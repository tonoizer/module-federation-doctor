import fs from "node:fs/promises";
import path from "node:path";
import type { ViteLifecycleEngine, ViteLifecycleFacts, ViteLifecycleFlavor } from "./types.js";

const VITE_PLUS_PACKAGES = ["vite-plus", "@voidzero-dev/vite-plus-core"] as const;
const ROLLDOWN_VITE_PACKAGES = ["rolldown-vite"] as const;
const ROLLDOWN_ENGINE_PACKAGES = ["rolldown"] as const;

type PackageJson = {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(file, "utf8")) as unknown;
}

async function readRootPackage(root: string): Promise<PackageJson> {
  try {
    return (await readJson(path.join(root, "package.json"))) as PackageJson;
  } catch {
    return {};
  }
}

function declaredNames(pkg: PackageJson): Set<string> {
  return new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
    ...Object.keys(pkg.optionalDependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
  ]);
}

async function installedPackageName(root: string, name: string): Promise<string | undefined> {
  try {
    const value = (await readJson(path.join(root, "node_modules", name, "package.json"))) as {
      name?: string;
      version?: string;
    };
    return value.name ?? name;
  } catch {
    return undefined;
  }
}

async function packageEvidence(root: string, names: readonly string[]): Promise<string[]> {
  const declared = declaredNames(await readRootPackage(root));
  const found: string[] = [];
  for (const name of names) {
    if (declared.has(name)) {
      found.push(name);
      continue;
    }
    if (await installedPackageName(root, name)) found.push(name);
  }
  return found;
}

/**
 * Optional plugin-hook meta from Rolldown / Vite. Public fields only — never
 * scrape private Module Federation plugin state.
 */
export type ViteHookMeta = {
  rolldownVersion?: string;
  rollupVersion?: string;
};

function engineFromMeta(meta: ViteHookMeta | undefined): ViteLifecycleEngine | undefined {
  if (!meta) return undefined;
  if (typeof meta.rolldownVersion === "string" && meta.rolldownVersion.length > 0)
    return "rolldown";
  if (typeof meta.rollupVersion === "string" && meta.rollupVersion.length > 0) return "rollup";
  return undefined;
}

/**
 * Detect which Vite-family emit lifecycle the project uses.
 *
 * Supported MF entry path for all flavors: `@module-federation/doctor/vite`
 * next to `@module-federation/vite`. Direct Rolldown without the Vite MF
 * plugin is unsupported (Rolldown dropped built-in MF).
 */
export async function detectViteLifecycle(
  root: string,
  meta?: ViteHookMeta,
): Promise<ViteLifecycleFacts> {
  const evidence: string[] = [];
  const vitePlus = await packageEvidence(root, VITE_PLUS_PACKAGES);
  const rolldownVite = await packageEvidence(root, ROLLDOWN_VITE_PACKAGES);
  const rolldown = await packageEvidence(root, ROLLDOWN_ENGINE_PACKAGES);
  evidence.push(...vitePlus, ...rolldownVite, ...rolldown);

  const resolvedVite = await installedPackageName(root, "vite");
  if (resolvedVite && resolvedVite !== "vite") {
    evidence.push(`vite→${resolvedVite}`);
    if (
      resolvedVite === "@voidzero-dev/vite-plus-core" ||
      resolvedVite === "vite-plus" ||
      resolvedVite.includes("vite-plus")
    ) {
      return {
        flavor: "vite-plus",
        engine: "rolldown",
        evidence: [...new Set(evidence)].sort(),
      };
    }
    if (resolvedVite === "rolldown-vite" || resolvedVite.includes("rolldown")) {
      return {
        flavor: "rolldown-vite",
        engine: "rolldown",
        evidence: [...new Set(evidence)].sort(),
      };
    }
  }

  const metaEngine = engineFromMeta(meta);
  if (metaEngine === "rolldown") evidence.push("meta.rolldownVersion");
  if (metaEngine === "rollup") evidence.push("meta.rollupVersion");

  let flavor: ViteLifecycleFlavor = "vite";
  let engine: ViteLifecycleEngine = metaEngine ?? "rollup";

  if (vitePlus.length > 0 || resolvedVite === "@voidzero-dev/vite-plus-core") {
    flavor = "vite-plus";
    engine = "rolldown";
  } else if (rolldownVite.length > 0 || metaEngine === "rolldown" || rolldown.length > 0) {
    flavor = "rolldown-vite";
    engine = "rolldown";
  } else if (metaEngine === "rollup") {
    flavor = "vite";
    engine = "rollup";
  }

  return {
    flavor,
    engine,
    evidence: [...new Set(evidence)].sort(),
  };
}

export function withPostEmitHook(
  lifecycle: ViteLifecycleFacts,
  postEmitHook: ViteLifecycleFacts["postEmitHook"],
): ViteLifecycleFacts {
  return postEmitHook ? { ...lifecycle, postEmitHook } : { ...lifecycle };
}
