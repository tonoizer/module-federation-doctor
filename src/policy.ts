import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { builtInRules, federationRuleMeta, runtimeRuleMeta } from "./rules.js";
import type {
  DoctorExtendEntry,
  DoctorPolicyPack,
  DoctorPresetName,
  DoctorRule,
  RuleSetting,
  Severity,
} from "./types.js";

export const DOCTOR_PRESET_NAMES = [
  "recommended",
  "strict",
] as const satisfies readonly DoctorPresetName[];

export function definePolicyPack(pack: DoctorPolicyPack): DoctorPolicyPack {
  return pack;
}

function isDoctorRule(value: unknown): value is DoctorRule {
  return (
    !!value &&
    typeof value === "object" &&
    "meta" in value &&
    "check" in value &&
    typeof (value as DoctorRule).check === "function"
  );
}

function isPolicyPack(value: unknown): value is DoctorPolicyPack {
  if (!value || typeof value !== "object" || isDoctorRule(value)) return false;
  const pack = value as DoctorPolicyPack;
  return (
    pack.rules !== undefined ||
    pack.plugins !== undefined ||
    (typeof pack.name === "string" && pack.name.length > 0)
  );
}

function catalogSeverities(): Record<string, RuleSetting> {
  return {
    ...Object.fromEntries(builtInRules.map((rule) => [rule.meta.id, rule.meta.defaultSeverity])),
    ...Object.fromEntries(federationRuleMeta.map((rule) => [rule.id, rule.severity])),
    ...Object.fromEntries(runtimeRuleMeta.map((rule) => [rule.id, rule.severity])),
  };
}

function elevateStrict(severity: Severity): Severity {
  if (severity === "info") return "warning";
  if (severity === "warning") return "error";
  return "error";
}

/** Keep advisory / tooling signals from becoming hard CI failures under `strict`. */
const STRICT_KEEP: Record<string, RuleSetting> = {
  "doctor/partial-analysis": "warning",
  "shared/candidate": "warning",
};

export const recommendedPreset: DoctorPolicyPack = definePolicyPack({
  name: "recommended",
  rules: catalogSeverities(),
});

export const strictPreset: DoctorPolicyPack = definePolicyPack({
  name: "strict",
  rules: Object.fromEntries(
    Object.entries(catalogSeverities()).map(([id, setting]) => {
      if (Object.hasOwn(STRICT_KEEP, id)) return [id, STRICT_KEEP[id]!];
      if (setting === "info" || setting === "warning" || setting === "error") {
        return [id, elevateStrict(setting)];
      }
      return [id, setting];
    }),
  ),
});

export const presets: Record<DoctorPresetName, DoctorPolicyPack> = {
  recommended: recommendedPreset,
  strict: strictPreset,
};

export function isDoctorPresetName(value: string): value is DoctorPresetName {
  return (DOCTOR_PRESET_NAMES as readonly string[]).includes(value);
}

export interface ResolvedPolicy {
  /** Merged severity maps from presets then packs (later entries win). */
  rules: Record<string, RuleSetting>;
  /** Custom rules from packs and direct `defineRule` entries. */
  plugins: DoctorRule[];
  /** Preset / pack names applied, left to right. */
  applied: string[];
}

function normalizeExtends(
  value: DoctorExtendEntry | DoctorExtendEntry[] | undefined,
): DoctorExtendEntry[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function packLabel(pack: DoctorPolicyPack, fallback: string): string {
  return pack.name?.trim() || fallback;
}

async function loadModule(specifier: string, root: string): Promise<unknown> {
  // Non-goal: remote HTTP(S) policy download. Only local paths and package names.
  if (/^[a-z][a-z0-9+.-]*:/i.test(specifier)) {
    throw new Error(
      `Policy pack "${specifier}" uses a URL scheme. Doctor only loads local paths or installed packages (no remote HTTP download).`,
    );
  }
  const absolute =
    specifier.startsWith(".") || path.isAbsolute(specifier)
      ? path.resolve(root, specifier)
      : createRequire(path.join(root, "package.json")).resolve(specifier);
  return import(pathToFileURL(absolute).href);
}

function unpackModule(mod: unknown, specifier: string): DoctorExtendEntry {
  const value =
    mod && typeof mod === "object" && "default" in mod
      ? (mod as { default: unknown }).default
      : mod;
  if (typeof value === "string" || isDoctorRule(value) || isPolicyPack(value)) return value;
  if (
    value &&
    typeof value === "object" &&
    "pack" in value &&
    isPolicyPack((value as { pack: unknown }).pack)
  ) {
    return (value as { pack: DoctorPolicyPack }).pack;
  }
  throw new Error(
    `Policy pack module "${specifier}" must default-export a DoctorPolicyPack, DoctorRule, or preset name.`,
  );
}

/**
 * Resolve `extends` entries into merged severity maps and custom rule plugins.
 * Precedence inside extends is left → right (later wins). Callers merge local
 * `DoctorOptions.rules` on top afterward (CLI/flags > local > pack > preset).
 */
export async function resolvePolicy(
  extendsValue: DoctorExtendEntry | DoctorExtendEntry[] | undefined,
  root: string,
): Promise<ResolvedPolicy> {
  const rules: Record<string, RuleSetting> = {};
  const plugins: DoctorRule[] = [];
  const applied: string[] = [];
  const seenRules = new Set<string>();

  const appendPlugin = (rule: DoctorRule) => {
    if (seenRules.has(rule.meta.id)) {
      const index = plugins.findIndex((item) => item.meta.id === rule.meta.id);
      if (index >= 0) plugins.splice(index, 1);
    }
    seenRules.add(rule.meta.id);
    plugins.push(rule);
  };

  const applyPack = (pack: DoctorPolicyPack, label: string) => {
    applied.push(packLabel(pack, label));
    if (pack.rules) Object.assign(rules, pack.rules);
    for (const rule of pack.plugins ?? []) appendPlugin(rule);
  };

  for (const entry of normalizeExtends(extendsValue)) {
    if (typeof entry === "string") {
      if (isDoctorPresetName(entry)) {
        applyPack(presets[entry], entry);
        continue;
      }
      const loaded = unpackModule(await loadModule(entry, root), entry);
      if (typeof loaded === "string") {
        if (!isDoctorPresetName(loaded)) {
          throw new Error(`Unknown Doctor preset "${loaded}" loaded from "${entry}".`);
        }
        applyPack(presets[loaded], loaded);
      } else if (isDoctorRule(loaded)) {
        applied.push(entry);
        appendPlugin(loaded);
      } else {
        applyPack(loaded, entry);
      }
      continue;
    }
    if (isDoctorRule(entry)) {
      applied.push(entry.meta.id);
      appendPlugin(entry);
      continue;
    }
    if (isPolicyPack(entry)) {
      applyPack(entry, "policy-pack");
      continue;
    }
    throw new Error(`Unsupported Doctor extends entry: ${String(entry)}`);
  }

  return { rules, plugins, applied };
}
