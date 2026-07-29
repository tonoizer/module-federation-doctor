/** Internal rollout controls for evidence architecture v2.
 *
 * This module only chooses a mode. It does not run collectors, rules, or
 * writers. Keeping that boundary makes the v1 path unchanged until a scope
 * has passed its release gates.
 */

export const EVIDENCE_LEGACY_ENV = "MFDOCTOR_EVIDENCE_LEGACY";

type RolloutScopeValue =
  | "config"
  | "build-artifacts"
  | "runtime-reports"
  | "runtime-capture"
  | "rules"
  | "federation-workspace"
  | "governance";
type ReleaseGateValue =
  | "dependency"
  | "schema"
  | "parity"
  | "matrix"
  | "migration"
  | "security"
  | "performance"
  | "stability"
  | "rollback"
  | "docs";

// Keep these authoritative values private. Public arrays are frozen copies so
// a consumer cannot mutate the validation policy through an exported value.
const AUTHORITATIVE_SCOPES = Object.freeze([
  "config",
  "build-artifacts",
  "runtime-reports",
  "runtime-capture",
  "rules",
  "federation-workspace",
  "governance",
] as const);
const AUTHORITATIVE_GATES = Object.freeze([
  "dependency",
  "schema",
  "parity",
  "matrix",
  "migration",
  "security",
  "performance",
  "stability",
  "rollback",
  "docs",
] as const);

export const ROLLOUT_SCOPES = Object.freeze([
  ...AUTHORITATIVE_SCOPES,
]) as typeof AUTHORITATIVE_SCOPES;
export type RolloutScope = RolloutScopeValue;
export type RolloutMode = "legacy" | "shadow" | "v2-compat" | "v2-preview";

export const RELEASE_GATES = Object.freeze([...AUTHORITATIVE_GATES]) as typeof AUTHORITATIVE_GATES;
export type ReleaseGate = ReleaseGateValue;
export type ReleaseGateStatus = Partial<Record<ReleaseGate, boolean>>;
export type ScopedRolloutModes = Partial<Record<RolloutScope, RolloutMode>>;

export interface EvidenceRolloutOptions {
  /** Defaults to legacy. Kept explicit so adding a scope cannot enable v2. */
  defaultMode?: RolloutMode;
  scopes?: ScopedRolloutModes;
  /** Injectable environment for adapters and tests. Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
}

export interface EvidenceRolloutController {
  readonly defaultMode: RolloutMode;
  readonly emergencyLegacy: boolean;
  modeFor(scope: RolloutScope): RolloutMode;
  modes(): Readonly<Record<RolloutScope, RolloutMode>>;
  withModes(scopes: ScopedRolloutModes): EvidenceRolloutController;
  promoteToCompat(scope: RolloutScope, gates: ReleaseGateStatus): EvidenceRolloutController;
}

export class RolloutGateError extends Error {
  readonly scope: RolloutScope;
  readonly missingGates: readonly ReleaseGate[];

  constructor(scope: RolloutScope, missingGates: readonly ReleaseGate[]) {
    super(
      `Cannot promote ${scope} to v2-compat; release gates are not green: ${missingGates.join(", ")}`,
    );
    this.name = "RolloutGateError";
    this.scope = scope;
    this.missingGates = Object.freeze([...missingGates]);
  }
}

type TrustedRecord = Record<string, unknown>;
type ModeMap = Record<RolloutScope, RolloutMode>;

function isTruthyEnv(value: unknown): boolean {
  return (
    typeof value === "string" && ["1", "true", "yes", "on"].includes(value.trim().toLowerCase())
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRolloutScope(value: unknown): value is RolloutScope {
  return typeof value === "string" && (AUTHORITATIVE_SCOPES as readonly string[]).includes(value);
}

function isReleaseGate(value: string): value is ReleaseGate {
  return (AUTHORITATIVE_GATES as readonly string[]).includes(value);
}

function assertMode(mode: unknown): asserts mode is RolloutMode {
  if (!["legacy", "shadow", "v2-compat", "v2-preview"].includes(mode as string)) {
    throw new TypeError(`Unknown evidence rollout mode: ${String(mode)}`);
  }
}

function assertSelectableMode(mode: unknown): asserts mode is Exclude<RolloutMode, "v2-compat"> {
  assertMode(mode);
  if (mode === "v2-compat") {
    throw new TypeError(
      "v2-compat can only be entered through promoteToCompat after release gates pass",
    );
  }
}

function assertScope(scope: unknown): asserts scope is RolloutScope {
  if (!isRolloutScope(scope))
    throw new TypeError(`Unknown evidence rollout scope: ${String(scope)}`);
}

function assertExternalRecord(
  value: unknown,
  label: string,
): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`${label} must be a non-array object`);
}

/** Snapshot own enumerable values exactly once into a frozen null-prototype object. */
function snapshotRecord(
  value: unknown,
  label: string,
  validateKey: (key: string) => boolean,
): Readonly<TrustedRecord> {
  assertExternalRecord(value, label);
  const source = value;
  const snapshot = Object.create(null) as TrustedRecord;
  for (const key of Object.keys(source)) {
    if (!validateKey(key)) throw new TypeError(`Unknown ${label} key: ${key}`);
    snapshot[key] = source[key];
  }
  return Object.freeze(snapshot);
}

function snapshotOptions(value: unknown): Readonly<TrustedRecord> {
  assertExternalRecord(value, "options");
  const snapshot = Object.create(null) as TrustedRecord;
  snapshot.defaultMode = Object.prototype.hasOwnProperty.call(value, "defaultMode")
    ? value.defaultMode
    : undefined;
  snapshot.scopes = Object.prototype.hasOwnProperty.call(value, "scopes")
    ? value.scopes
    : undefined;
  snapshot.env = Object.prototype.hasOwnProperty.call(value, "env") ? value.env : undefined;
  return Object.freeze(snapshot);
}

function snapshotModes(value: unknown): Readonly<TrustedRecord> {
  if (value === undefined) return Object.freeze(Object.create(null) as TrustedRecord);
  const snapshot = snapshotRecord(value, "rollout scope", isRolloutScope);
  for (const key of AUTHORITATIVE_SCOPES) {
    if (Object.prototype.hasOwnProperty.call(snapshot, key)) assertSelectableMode(snapshot[key]);
  }
  return snapshot;
}

function snapshotGates(value: unknown): Readonly<TrustedRecord> {
  const snapshot = snapshotRecord(value, "release gate", isReleaseGate);
  return snapshot;
}

function copyModeMap(source: Readonly<TrustedRecord>): Readonly<TrustedRecord> {
  const copy = Object.create(null) as TrustedRecord;
  for (const scope of AUTHORITATIVE_SCOPES) {
    const mode = source[scope];
    if (mode !== undefined) {
      assertMode(mode);
      copy[scope] = mode;
    }
  }
  return Object.freeze(copy);
}

function readEnvironmentFlag(value: unknown): unknown {
  if (!isRecord(value)) return undefined;
  return Object.prototype.hasOwnProperty.call(value, EVIDENCE_LEGACY_ENV)
    ? value[EVIDENCE_LEGACY_ENV]
    : undefined;
}

function createController(
  defaultMode: RolloutMode,
  scopedModes: Readonly<TrustedRecord>,
  emergencyLegacy: boolean,
): EvidenceRolloutController {
  assertMode(defaultMode);
  const safeDefaultMode = defaultMode;
  const safeScopedModes = copyModeMap(scopedModes);
  const safeEmergencyLegacy = emergencyLegacy === true;

  const modeFor = (scope: RolloutScope): RolloutMode => {
    assertScope(scope);
    if (safeEmergencyLegacy) return "legacy";
    return (safeScopedModes[scope] as RolloutMode | undefined) ?? safeDefaultMode;
  };
  const modes = (): Readonly<Record<RolloutScope, RolloutMode>> => {
    const result = Object.create(null) as ModeMap;
    for (const scope of AUTHORITATIVE_SCOPES) result[scope] = modeFor(scope);
    return Object.freeze(result);
  };
  const withModes = (externalModes: ScopedRolloutModes): EvidenceRolloutController => {
    const nextModes = snapshotModes(externalModes);
    const merged = Object.create(null) as TrustedRecord;
    for (const scope of AUTHORITATIVE_SCOPES) {
      const existing = safeScopedModes[scope];
      const next = nextModes[scope];
      if (next !== undefined) merged[scope] = next;
      else if (existing !== undefined) merged[scope] = existing;
    }
    return createController(safeDefaultMode, Object.freeze(merged), safeEmergencyLegacy);
  };
  const promoteToCompat = (
    scope: RolloutScope,
    externalGates: ReleaseGateStatus,
  ): EvidenceRolloutController => {
    assertScope(scope);
    const gates = snapshotGates(externalGates);
    const missingGates = AUTHORITATIVE_GATES.filter((gate) => gates[gate] !== true);
    if (missingGates.length > 0) throw new RolloutGateError(scope, missingGates);
    if (modeFor(scope) !== "shadow") {
      throw new Error(
        `Cannot promote ${scope} from ${modeFor(scope)}; scope must be in shadow mode`,
      );
    }
    const nextModes = Object.create(null) as TrustedRecord;
    for (const key of AUTHORITATIVE_SCOPES) nextModes[key] = safeScopedModes[key];
    nextModes[scope] = "v2-compat";
    return createController(safeDefaultMode, Object.freeze(nextModes), safeEmergencyLegacy);
  };

  return Object.freeze({
    defaultMode: safeDefaultMode,
    emergencyLegacy: safeEmergencyLegacy,
    modeFor,
    modes,
    withModes,
    promoteToCompat,
  });
}

/** Create a scoped controller. Legacy is the safe default and the rollback mode. */
export function createEvidenceRolloutController(
  options: EvidenceRolloutOptions = {},
): EvidenceRolloutController {
  const safeOptions = snapshotOptions(options);
  const rawDefaultMode = safeOptions.defaultMode;
  const defaultMode = rawDefaultMode === undefined ? "legacy" : rawDefaultMode;
  assertSelectableMode(defaultMode);
  const scopedModes = snapshotModes(safeOptions.scopes);
  const rawEnvironment = safeOptions.env === undefined ? process.env : safeOptions.env;
  const emergencyLegacy = isTruthyEnv(readEnvironmentFlag(rawEnvironment));
  return createController(defaultMode, scopedModes, emergencyLegacy);
}
