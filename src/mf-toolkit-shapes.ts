/**
 * Soft recognition of mf-toolkit config shapes (mf-bridge, mf-ssr fragment URLs,
 * shared-inspector MF2 shared arrays). Used to skip false findings — never to
 * mutate existing finding evidence (fingerprint stability).
 *
 * Fixtures: fixtures/mf-bridge-entry, fixtures/mf-ssr-fragment, fixtures/shared-inspector-mf2.
 * Full Bridge pack (#131) and vendoring mf-toolkit are out of scope.
 */
import type { NormalizedMFConfig, ProjectFacts, RuleContext } from "./types.js";

/** Bridge entry public key used by mf-bridge remotes. */
export const MF_BRIDGE_ENTRY_EXPOSE = "./entry";

/** Fragment expose key used by mf-ssr fragment producers. */
export const MF_SSR_FRAGMENT_EXPOSE = "./fragment";

const FRAGMENT_PATH_RE = /\/(?:api\/)?fragments\//i;
const CLASSIC_REMOTE_ENTRY_RE = /remoteEntry(?:\.[cm]?js)?(?:[?#]|$)/i;
const MANIFEST_ENTRY_RE = /\.mf-manifest\.json(?:[?#]|$)/i;

function mf(facts: ProjectFacts): NormalizedMFConfig | undefined {
  return facts.moduleFederation;
}

/**
 * Resolve whether toolkit soft-exceptions apply.
 * Precedence: per-rule `options.recognizeMfToolkit` → top-level `context.recognizeMfToolkit`
 * → default true only when `signalsPresent`.
 */
export function toolkitRecognitionEnabled(
  context: Pick<RuleContext, "options" | "recognizeMfToolkit">,
  signalsPresent: boolean,
): boolean {
  const ruleOption = context.options.recognizeMfToolkit;
  if (ruleOption === false) return false;
  if (ruleOption === true) return true;
  if (context.recognizeMfToolkit === false) return false;
  if (context.recognizeMfToolkit === true) return true;
  return signalsPresent;
}

/** True when this project exposes the mf-bridge `./entry` contract. */
export function hasMfBridgeEntryExpose(facts: ProjectFacts): boolean {
  const exposes = mf(facts)?.exposes;
  return Boolean(exposes && Object.hasOwn(exposes, MF_BRIDGE_ENTRY_EXPOSE));
}

/**
 * True when exposes are bridge-entry shaped (only `./entry`, or `./entry` plus
 * no classic component-style exposes that would still need DTS guidance).
 * Used to quiet component/DTS producer guidance for intentional bridge remotes.
 */
export function isMfBridgeEntryProducer(facts: ProjectFacts): boolean {
  const exposes = mf(facts)?.exposes;
  if (!exposes || !Object.hasOwn(exposes, MF_BRIDGE_ENTRY_EXPOSE)) return false;
  const keys = Object.keys(exposes);
  // Pure bridge entry, or bridge entry + fragment (toolkit hybrids).
  return keys.every((key) => key === MF_BRIDGE_ENTRY_EXPOSE || key === MF_SSR_FRAGMENT_EXPOSE);
}

/** True when producer exposes mf-ssr `./fragment`. */
export function isMfSsrFragmentProducer(facts: ProjectFacts): boolean {
  const exposes = mf(facts)?.exposes;
  return Boolean(exposes && Object.hasOwn(exposes, MF_SSR_FRAGMENT_EXPOSE));
}

/**
 * mf-ssr fragment URL / path remotes (not classic remoteEntry.js or mf-manifest.json).
 * Matches absolute HTTPS fragment hosts and relative `/api/fragments/...` paths.
 */
export function isMfSsrFragmentRemoteEntry(entry: string | undefined): boolean {
  if (!entry || typeof entry !== "string") return false;
  const trimmed = entry.trim();
  if (!trimmed) return false;
  if (CLASSIC_REMOTE_ENTRY_RE.test(trimmed)) return false;
  if (MANIFEST_ENTRY_RE.test(trimmed)) return false;
  return FRAGMENT_PATH_RE.test(trimmed);
}

/** True when any configured remote uses fragment URL mode. */
export function hasMfSsrFragmentRemotes(facts: ProjectFacts): boolean {
  const remotes = mf(facts)?.remotes;
  if (!remotes) return false;
  return Object.values(remotes).some((remote) => isMfSsrFragmentRemoteEntry(remote.entry));
}

/**
 * Doctor-normalized MF2 shared-array evidence (shared-inspector stress shape).
 * Normalized manifests drop MF2 `from`; presence of a non-empty shared array on
 * a valid manifest is the alignment signal.
 */
export function hasMf2SharedArrayManifest(facts: ProjectFacts): boolean {
  const manifest = facts.artifacts.manifest;
  return Boolean(manifest?.valid && Array.isArray(manifest.shared) && manifest.shared.length > 0);
}

/**
 * Manifest-only shared evidence without source import scan — shared-inspector /
 * MF2 shared-array inputs where unused heuristics would false-positive.
 */
export function isMf2SharedArrayManifestOnly(facts: ProjectFacts): boolean {
  if (!hasMf2SharedArrayManifest(facts)) return false;
  if (facts.capabilities.sourceImports) return false;
  const sources = facts.imports.evidenceSources ?? [];
  return sources.length > 0 && sources.every((source) => source === "manifest");
}

/** Any toolkit shape signal worth enabling soft-exceptions by default. */
export function hasMfToolkitShapeSignals(facts: ProjectFacts): boolean {
  return (
    hasMfBridgeEntryExpose(facts) ||
    isMfSsrFragmentProducer(facts) ||
    hasMfSsrFragmentRemotes(facts) ||
    isMf2SharedArrayManifestOnly(facts)
  );
}

/** Soft-skip DTS / component-style producer guidance for bridge entry remotes. */
export function shouldSkipBridgeEntryDtsGuidance(context: RuleContext): boolean {
  const signal = isMfBridgeEntryProducer(context.facts);
  return toolkitRecognitionEnabled(context, signal) && signal;
}

/** Soft-skip invalid-entry for a single remote when it is an mf-ssr fragment URL. */
export function shouldSkipFragmentRemoteEntryInvalid(
  context: RuleContext,
  entry: string | undefined,
): boolean {
  const signal = isMfSsrFragmentRemoteEntry(entry);
  return toolkitRecognitionEnabled(context, signal) && signal;
}

/** Soft-skip shared/unused when only MF2 shared-array manifest evidence is present. */
export function shouldSkipMf2SharedUnused(context: RuleContext): boolean {
  const signal = isMf2SharedArrayManifestOnly(context.facts);
  return toolkitRecognitionEnabled(context, signal) && signal;
}
