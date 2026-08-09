import { createHash } from "node:crypto";
import type {
  FederationInstanceRef,
  ModuleFederationConfigLike,
  ModuleFederationInstanceInput,
} from "./types.js";
import { readCanonicalModuleFederationConfig } from "./canonical-config.js";
import { stableStringify } from "./utils.js";

const DEFAULT_PLUGIN_NAME = "ModuleFederationPlugin";

export interface FederationInstanceDescriptor extends FederationInstanceRef {
  config: ModuleFederationConfigLike;
  /** Zero-based registration order, retained only for deterministic diagnostics. */
  registrationIndex: number;
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableStringify(value)).digest("hex")}`;
}

/**
 * Canonicalize a plugin config for identity only. The canonical reader avoids
 * executing getters and drops executable values, which keeps IDs stable across
 * object insertion order and safe for persisted evidence.
 */
export function federationConfigDigest(config: ModuleFederationConfigLike): string {
  const canonical = readCanonicalModuleFederationConfig(config);
  return digest(canonical?.declared ?? config);
}

function makeRegistrationGroup(pluginName: string, configDigest: string): string {
  return digest({ pluginName, configDigest });
}

function instanceId(
  pluginName: string,
  configDigest: string,
  group: string,
  occurrence: number,
  duplicate: boolean,
): string {
  const material = {
    pluginName,
    configDigest,
    registrationGroup: group,
    ...(duplicate ? { occurrence } : {}),
  };
  const key = createHash("sha256").update(stableStringify(material)).digest("hex").slice(0, 24);
  return `mfid:v1:federation-instance:${key}`;
}

/** Accept both the explicit wrapper form and the convenient raw-config form. */
export function coerceFederationInstanceInputs(
  inputs: Array<ModuleFederationInstanceInput | ModuleFederationConfigLike> | undefined,
): ModuleFederationInstanceInput[] {
  if (!inputs?.length) return [];
  return inputs.flatMap((input) => {
    if (!input || typeof input !== "object") return [];
    if (
      "config" in input &&
      input.config &&
      typeof input.config === "object" &&
      !Array.isArray(input.config)
    ) {
      return [
        {
          config: input.config as ModuleFederationConfigLike,
          ...(typeof input.pluginName === "string" && input.pluginName.length > 0
            ? { pluginName: input.pluginName }
            : {}),
        },
      ];
    }
    return [{ config: input as ModuleFederationConfigLike }];
  });
}

/**
 * Describe registrations in input order while deriving IDs from configuration
 * content rather than array position. Truly identical registrations receive
 * occurrence-qualified IDs and the same registration group, so the duplicate
 * finding can name every affected scope.
 */
export function describeFederationInstances(
  inputs: ModuleFederationInstanceInput[],
): FederationInstanceDescriptor[] {
  const prepared = inputs.map((input, registrationIndex) => {
    const pluginName = input.pluginName?.trim() || DEFAULT_PLUGIN_NAME;
    const configDigest = federationConfigDigest(input.config);
    const group = makeRegistrationGroup(pluginName, configDigest);
    return { input, pluginName, configDigest, group, registrationIndex };
  });
  const groupCounts = new Map<string, number>();
  for (const item of prepared) groupCounts.set(item.group, (groupCounts.get(item.group) ?? 0) + 1);
  const occurrences = new Map<string, number>();
  return prepared.map((item) => {
    const occurrence = occurrences.get(item.group) ?? 0;
    occurrences.set(item.group, occurrence + 1);
    const duplicate = (groupCounts.get(item.group) ?? 0) > 1;
    const id = instanceId(item.pluginName, item.configDigest, item.group, occurrence, duplicate);
    return {
      id,
      pluginName: item.pluginName,
      configDigest: item.configDigest,
      registrationGroup: item.group,
      config: item.input.config,
      registrationIndex: item.registrationIndex,
    };
  });
}

export function federationInstanceRefs(
  descriptors: FederationInstanceDescriptor[],
): FederationInstanceRef[] {
  return descriptors.map(({ id, pluginName, configDigest, registrationGroup: group }) => ({
    id,
    pluginName,
    configDigest,
    registrationGroup: group,
  }));
}

export function duplicateFederationInstanceGroups(
  refs: FederationInstanceRef[] | undefined,
): FederationInstanceRef[][] {
  if (!refs?.length) return [];
  const groups = new Map<string, FederationInstanceRef[]>();
  for (const ref of refs)
    groups.set(ref.registrationGroup, [...(groups.get(ref.registrationGroup) ?? []), ref]);
  return [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => group.slice().sort((left, right) => left.id.localeCompare(right.id)))
    .sort((left, right) => left[0]!.registrationGroup.localeCompare(right[0]!.registrationGroup));
}
