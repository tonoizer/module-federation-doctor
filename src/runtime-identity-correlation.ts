import type { RuntimeCaptureIdentity } from "./capture.js";
import {
  createRuntimeInstanceIdentity,
  createRuntimeRealmIdentity,
  IdentityValidationError,
  unknownIdentity,
  type IdentityCompleteness,
  type IdentityConfidence,
  type IdentityRealm,
  type IdentityTarget,
  type RuntimeInstanceIdentity,
  type RuntimeRealmIdentity,
} from "./identity.js";
import {
  isSemanticIdentityKey,
  type IdentityCorrelationOutcome,
  type IdentityCorrelationScope,
} from "./identity-correlation.js";

/** Version of the additive runtime-capture identity projection contract. */
export const RUNTIME_IDENTITY_CORRELATION_SCHEMA_VERSION = 1 as const;
export type RuntimeIdentityCorrelationSchemaVersion =
  typeof RUNTIME_IDENTITY_CORRELATION_SCHEMA_VERSION;

export type RuntimeCaptureIdentitySource = Pick<
  RuntimeCaptureIdentity,
  "captureId" | "realmId" | "runtimeVersion" | "instanceName"
>;

export interface RuntimeIdentityCorrelationOptions {
  target: IdentityTarget;
  realm: IdentityRealm;
  deploymentKey?: string;
  environmentKey?: string;
  realmId?: string;
  runtimeInstanceId?: string;
  runtimePackage?: string;
  runtimeVersion?: string;
}

export interface RuntimeCaptureIdentityProjection {
  schemaVersion: RuntimeIdentityCorrelationSchemaVersion;
  captureId: string;
  deploymentKey: string;
  scope: IdentityCorrelationScope;
  realm: RuntimeRealmIdentity;
  instance: RuntimeInstanceIdentity;
  outcome: Exclude<IdentityCorrelationOutcome, "ambiguous">;
  completeness: IdentityCompleteness;
  confidence: IdentityConfidence;
  missing: string[];
  reason: string;
}

const TARGETS = new Set<IdentityTarget>(["browser", "ssr", "worker", "mobile", "node", "unknown"]);
const REALMS = new Set<IdentityRealm>([
  "top-frame",
  "iframe",
  "worker",
  "node",
  "react-native",
  "unknown",
]);
const UNSAFE_VALUE =
  /(?:[A-Za-z]:[\\/]|\\\\|^\/|[a-z][a-z\d+.-]*:\/\/|[?&](?:token|sig|signature|expires|auth|authorization|password|secret|credential|session|key)(?:=|&|$))/i;
const VOLATILE_VALUE =
  /^(?:\d{10,13}|\d{4}-\d{2}-\d{2}(?:[Tt ]|$)|(?:process|session|tab|pid|sid)(?:[-_:]|$))/i;
const MAX_OPAQUE_LENGTH = 128;

function safeValue(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_OPAQUE_LENGTH &&
    value !== "unknown" &&
    !UNSAFE_VALUE.test(value) &&
    !VOLATILE_VALUE.test(value)
  );
}

function safeOrUnknown(value: unknown): { value: string; known: boolean } {
  return safeValue(value) ? { value, known: true } : { value: "unknown", known: false };
}

function assertScopeEnum<T extends string>(value: T, allowed: ReadonlySet<T>, label: string): void {
  if (!allowed.has(value))
    throw new IdentityValidationError(`${label} must be a supported enum value.`);
}

function assertReferenceKey(value: string, label: string, kind: string): void {
  if (!isSemanticIdentityKey(value) || !value.startsWith(`mfid:v1:${kind}:`))
    throw new IdentityValidationError(`${label} must reference a ${kind} identity.`);
}

function projectionCompleteness(known: readonly boolean[]): IdentityCompleteness {
  if (known.every(Boolean)) return "complete";
  if (known.some(Boolean)) return "partial";
  return "unknown";
}

function projectionConfidence(known: readonly boolean[]): IdentityConfidence {
  if (known.every(Boolean)) return "exact";
  if (known.filter(Boolean).length >= 3) return "strong";
  if (known.some(Boolean)) return "weak";
  return "unknown";
}

/**
 * Project one sanitized external-capture identity into explicit runtime-realm
 * and runtime-instance identities. Missing deployment/instance facts remain
 * source-scoped unknowns; names alone never become semantic proof.
 */
export function projectRuntimeCaptureIdentity(
  source: RuntimeCaptureIdentitySource,
  options: RuntimeIdentityCorrelationOptions,
): RuntimeCaptureIdentityProjection {
  if (!safeValue(source.captureId))
    throw new IdentityValidationError("captureId must be a bounded non-sensitive opaque ID.");
  assertScopeEnum(options.target, TARGETS, "target");
  assertScopeEnum(options.realm, REALMS, "realm");
  if (options.deploymentKey !== undefined)
    assertReferenceKey(options.deploymentKey, "deploymentKey", "deployment");
  if (options.environmentKey !== undefined)
    assertReferenceKey(options.environmentKey, "environmentKey", "environment");

  const deployment = options.deploymentKey
    ? { key: options.deploymentKey, known: true }
    : {
        key: unknownIdentity("deployment", `runtime-capture:${source.captureId}`).key,
        known: false,
      };
  const realmId = safeOrUnknown(options.realmId ?? source.realmId);
  const runtimeInstanceId = safeOrUnknown(options.runtimeInstanceId);
  const runtimePackage = safeOrUnknown(options.runtimePackage);
  const runtimeVersion = safeOrUnknown(options.runtimeVersion ?? source.runtimeVersion);
  const realmKnown = options.realm !== "unknown" && realmId.known;
  const realmCompleteness = projectionCompleteness([deployment.known, realmKnown]);
  const realmConfidence = projectionConfidence([deployment.known, realmKnown]);
  const realm = createRuntimeRealmIdentity(
    {
      deploymentKey: deployment.key,
      realm: options.realm,
      realmId: realmId.value,
    },
    {
      parentKey: deployment.key,
      completeness: realmCompleteness,
      confidence: realmConfidence,
      provenance: { source: "runtime", evidenceIds: [] },
    },
  );
  const instanceKnown = runtimeInstanceId.known;
  const targetKnown = options.target !== "unknown";
  const instanceCompleteness = projectionCompleteness([
    deployment.known,
    realmKnown,
    instanceKnown,
    runtimePackage.known,
    runtimeVersion.known,
  ]);
  const instanceConfidence = projectionConfidence([
    deployment.known,
    realmKnown,
    instanceKnown,
    runtimePackage.known,
    runtimeVersion.known,
  ]);
  const instance = createRuntimeInstanceIdentity(
    {
      realmKey: realm.key,
      runtimeInstanceId: runtimeInstanceId.value,
      runtimePackage: runtimePackage.value,
      runtimeVersion: runtimeVersion.value,
    },
    {
      parentKey: realm.key,
      completeness: instanceCompleteness,
      confidence: instanceConfidence,
      provenance: { source: "runtime", evidenceIds: [] },
    },
  );
  const known = [
    targetKnown,
    deployment.known,
    realmKnown,
    instanceKnown,
    runtimePackage.known,
    runtimeVersion.known,
  ];
  const scope: IdentityCorrelationScope = {
    target: options.target,
    realm: options.realm,
    ...(options.environmentKey === undefined ? {} : { environmentKey: options.environmentKey }),
  };
  const missing = [
    ...(deployment.known ? [] : ["deploymentKey"]),
    ...(realmKnown ? [] : ["realmId"]),
    ...(instanceKnown ? [] : ["runtimeInstanceId"]),
    ...(runtimePackage.known ? [] : ["runtimePackage"]),
    ...(runtimeVersion.known ? [] : ["runtimeVersion"]),
  ];
  const completeness = projectionCompleteness(known);
  const confidence =
    options.target === "unknown" || options.realm === "unknown"
      ? "unknown"
      : projectionConfidence(known);
  const outcome: Exclude<IdentityCorrelationOutcome, "ambiguous"> =
    confidence === "exact"
      ? "exact"
      : confidence === "strong"
        ? "strong"
        : confidence === "weak"
          ? "weak"
          : "unknown";
  return {
    schemaVersion: RUNTIME_IDENTITY_CORRELATION_SCHEMA_VERSION,
    captureId: source.captureId,
    deploymentKey: deployment.key,
    scope,
    realm,
    instance,
    outcome,
    completeness,
    confidence,
    missing,
    reason:
      outcome === "exact"
        ? "explicit deployment, realm, instance, package, and version evidence projected"
        : "runtime capture does not prove every deployment or instance identity dimension",
  };
}
