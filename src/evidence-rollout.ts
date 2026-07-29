/** Internal rollout controls for evidence architecture v2.
 *
 * This module only chooses a mode. It does not run collectors, rules, or
 * writers. Keeping that boundary makes the v1 path unchanged until a scope
 * has passed its release gates.
 */

export const EVIDENCE_LEGACY_ENV = "MFDOCTOR_EVIDENCE_LEGACY";

export const ROLLOUT_SCOPES = [
  "config",
  "build-artifacts",
  "runtime-reports",
  "runtime-capture",
  "rules",
  "federation-workspace",
  "governance",
] as const;

export type RolloutScope = (typeof ROLLOUT_SCOPES)[number];
export type RolloutMode = "legacy" | "shadow" | "v2-compat" | "v2-preview";

export const RELEASE_GATES = [
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
] as const;

export type ReleaseGate = (typeof RELEASE_GATES)[number];
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
    this.missingGates = missingGates;
  }
}

function isTruthyEnv(value: string | undefined): boolean {
  return value !== undefined && ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function isRolloutScope(value: string): value is RolloutScope {
  return (ROLLOUT_SCOPES as readonly string[]).includes(value);
}

function assertMode(mode: RolloutMode): void {
  if (!["legacy", "shadow", "v2-compat", "v2-preview"].includes(mode)) {
    throw new TypeError(`Unknown evidence rollout mode: ${String(mode)}`);
  }
}

function assertSelectableMode(mode: RolloutMode): void {
  assertMode(mode);
  if (mode === "v2-compat") {
    throw new TypeError(
      "v2-compat can only be entered through promoteToCompat after release gates pass",
    );
  }
}

function assertScope(scope: string): asserts scope is RolloutScope {
  if (!isRolloutScope(scope)) throw new TypeError(`Unknown evidence rollout scope: ${scope}`);
}

function copyModes(modes: ScopedRolloutModes): ScopedRolloutModes {
  return Object.fromEntries(Object.entries(modes)) as ScopedRolloutModes;
}

class Controller implements EvidenceRolloutController {
  readonly defaultMode: RolloutMode;
  readonly emergencyLegacy: boolean;
  private readonly scopedModes: ScopedRolloutModes;

  constructor(defaultMode: RolloutMode, scopedModes: ScopedRolloutModes, emergencyLegacy: boolean) {
    assertMode(defaultMode);
    for (const [scope, mode] of Object.entries(scopedModes)) {
      assertScope(scope);
      if (mode !== undefined) assertMode(mode);
    }
    this.defaultMode = defaultMode;
    this.scopedModes = copyModes(scopedModes);
    this.emergencyLegacy = emergencyLegacy;
  }

  modeFor(scope: RolloutScope): RolloutMode {
    assertScope(scope);
    if (this.emergencyLegacy) return "legacy";
    return this.scopedModes[scope] ?? this.defaultMode;
  }

  modes(): Readonly<Record<RolloutScope, RolloutMode>> {
    return Object.fromEntries(
      ROLLOUT_SCOPES.map((scope) => [scope, this.modeFor(scope)]),
    ) as Record<RolloutScope, RolloutMode>;
  }

  withModes(scopes: ScopedRolloutModes): EvidenceRolloutController {
    for (const mode of Object.values(scopes)) {
      if (mode !== undefined) assertSelectableMode(mode);
    }
    return new Controller(
      this.defaultMode,
      { ...this.scopedModes, ...copyModes(scopes) },
      this.emergencyLegacy,
    );
  }

  promoteToCompat(scope: RolloutScope, gates: ReleaseGateStatus): EvidenceRolloutController {
    const missingGates = RELEASE_GATES.filter((gate) => gates[gate] !== true);
    if (missingGates.length > 0) throw new RolloutGateError(scope, missingGates);
    if (this.modeFor(scope) !== "shadow") {
      throw new Error(
        `Cannot promote ${scope} from ${this.modeFor(scope)}; scope must be in shadow mode`,
      );
    }
    return new Controller(
      this.defaultMode,
      { ...this.scopedModes, [scope]: "v2-compat" },
      this.emergencyLegacy,
    );
  }
}

/** Create a scoped controller. Legacy is the safe default and the rollback mode. */
export function createEvidenceRolloutController(
  options: EvidenceRolloutOptions = {},
): EvidenceRolloutController {
  if (options.defaultMode !== undefined) assertSelectableMode(options.defaultMode);
  for (const mode of Object.values(options.scopes ?? {})) {
    if (mode !== undefined) assertSelectableMode(mode);
  }
  const env = options.env ?? process.env;
  const emergencyLegacy = isTruthyEnv(env[EVIDENCE_LEGACY_ENV]);
  return new Controller(options.defaultMode ?? "legacy", options.scopes ?? {}, emergencyLegacy);
}
