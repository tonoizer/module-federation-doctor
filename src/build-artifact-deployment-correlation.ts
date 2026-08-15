import {
  IdentityValidationError,
  type ArtifactIdentity,
  type BuildIdentity,
  type DeploymentIdentity,
  type EnvironmentIdentity,
  type IdentityCompleteness,
  type IdentityConfidence,
} from "./identity.js";
import { isSemanticIdentityKey } from "./identity-correlation.js";
import { compareCodePoint } from "./utils.js";

/** Version of the additive build/artifact/deployment correlation contract. */
export const BUILD_ARTIFACT_DEPLOYMENT_SCHEMA_VERSION = 1 as const;
export type BuildArtifactDeploymentSchemaVersion = typeof BUILD_ARTIFACT_DEPLOYMENT_SCHEMA_VERSION;

export type BuildArtifactDeploymentOutcome = "exact" | "strong" | "weak" | "unknown";

export interface BuildArtifactDeploymentCorrelationInput {
  build: BuildIdentity;
  artifacts: readonly ArtifactIdentity[];
  deployment: DeploymentIdentity;
  environment?: EnvironmentIdentity;
  evidenceIds?: readonly string[];
}

export interface BuildArtifactDeploymentCorrelation {
  schemaVersion: BuildArtifactDeploymentSchemaVersion;
  kind: "build-artifact-deployment";
  buildKey: string;
  buildLineageKey: string;
  artifactKeys: string[];
  deploymentKey: string;
  environmentKey: string;
  outcome: BuildArtifactDeploymentOutcome;
  completeness: IdentityCompleteness;
  confidence: IdentityConfidence;
  matchedDimensions: string[];
  missing: string[];
  conflicts: string[];
  evidenceIds: string[];
  reason: string;
}

export type DeploymentRelationshipKind = "redeploy" | "rollback";

export interface DeploymentRelationshipInput {
  deployment: DeploymentIdentity;
  relatedDeployment: DeploymentIdentity;
  relation: DeploymentRelationshipKind;
  evidenceIds?: readonly string[];
}

export interface DeploymentRelationshipCorrelation {
  schemaVersion: BuildArtifactDeploymentSchemaVersion;
  kind: "deployment-relationship";
  deploymentKey: string;
  relatedDeploymentKey: string;
  environmentKey: string;
  relation: DeploymentRelationshipKind;
  outcome: BuildArtifactDeploymentOutcome;
  completeness: IdentityCompleteness;
  confidence: IdentityConfidence;
  matchedDimensions: string[];
  missing: string[];
  conflicts: string[];
  evidenceIds: string[];
  reason: string;
}

const MAX_ARTIFACTS = 32;
const MAX_EVIDENCE_IDS = 32;
const MAX_EVIDENCE_ID_LENGTH = 128;
const SAFE_VALUE =
  /(?:[A-Za-z]:[\\/]|\\\\|^\/|[a-z][a-z\d+.-]*:\/\/|[?&](?:token|sig|signature|expires|auth|authorization|password|secret|credential|session|key)(?:=|&|$))/i;
const VOLATILE_VALUE =
  /^(?:\d{10,13}|\d{4}-\d{2}-\d{2}(?:[Tt ]|$)|(?:process|session|tab|pid|sid)(?:[-_:]|$))/i;

function assertIdentity(
  value: { schemaVersion: number; kind: string; key: string; parentKey?: string },
  expectedKind: string,
  label: string,
): void {
  if (value.schemaVersion !== 1 || value.kind !== expectedKind)
    throw new IdentityValidationError(`${label} must be a v1 ${expectedKind} identity.`);
  if (!isSemanticIdentityKey(value.key) || !value.key.startsWith(`mfid:v1:${expectedKind}:`))
    throw new IdentityValidationError(`${label}.key must match its identity kind.`);
  if (expectedKind !== "organization" && value.parentKey === undefined)
    throw new IdentityValidationError(`${label}.parentKey is required.`);
  if (value.parentKey !== undefined && !isSemanticIdentityKey(value.parentKey))
    throw new IdentityValidationError(`${label}.parentKey must be a semantic identity key.`);
}

function assertSafeValue(value: string, label: string, maxLength = MAX_EVIDENCE_ID_LENGTH): void {
  if (
    value.length === 0 ||
    value.length > maxLength ||
    SAFE_VALUE.test(value) ||
    VOLATILE_VALUE.test(value)
  )
    throw new IdentityValidationError(`${label} must be a bounded safe value.`);
}

function evidenceIds(values: readonly string[] | undefined): string[] {
  const normalized = [...new Set(values ?? [])];
  if (normalized.length > MAX_EVIDENCE_IDS)
    throw new IdentityValidationError("evidenceIds exceed maxItems (32).");
  for (const value of normalized) assertSafeValue(value, "evidenceIds");
  return normalized.sort(compareCodePoint);
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareCodePoint);
}

function deploymentArtifactKeys(deployment: DeploymentIdentity): string[] {
  if (!Array.isArray(deployment.artifactKeys) || deployment.artifactKeys.length === 0)
    throw new IdentityValidationError("deployment.artifactKeys must contain at least one key.");
  if (deployment.artifactKeys.length > MAX_ARTIFACTS)
    throw new IdentityValidationError("deployment.artifactKeys exceed maxItems (32).");
  for (const key of deployment.artifactKeys) {
    if (!isSemanticIdentityKey(key) || !key.startsWith("mfid:v1:artifact:"))
      throw new IdentityValidationError("deployment.artifactKeys must reference artifacts.");
  }
  return sortedUnique(deployment.artifactKeys);
}

function artifactSetEqual(left: readonly string[], right: readonly string[]): boolean {
  const leftKeys = sortedUnique(left);
  const rightKeys = sortedUnique(right);
  return (
    leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index])
  );
}

function completeness(values: readonly boolean[]): IdentityCompleteness {
  if (values.every(Boolean)) return "complete";
  if (values.some(Boolean)) return "partial";
  return "unknown";
}

function confidenceFor(
  outcome: BuildArtifactDeploymentOutcome,
  complete: boolean,
): IdentityConfidence {
  if (outcome === "unknown") return "unknown";
  if (outcome === "exact" && complete) return "exact";
  return outcome;
}

function validateArtifactSet(
  build: BuildIdentity,
  artifacts: readonly ArtifactIdentity[],
  deploymentKeys: readonly string[],
): { matched: string[]; missing: string[]; conflicts: string[]; artifactKeys: string[] } {
  if (artifacts.length > MAX_ARTIFACTS)
    throw new IdentityValidationError("artifacts exceed maxItems (32).");
  const artifactKeys = sortedUnique(artifacts.map((artifact) => artifact.key));
  const missing = deploymentKeys
    .filter((key) => !artifactKeys.includes(key))
    .map((key) => `artifact:${key}`);
  const conflicts = artifacts
    .filter((artifact) => artifact.parentKey !== build.key)
    .map((artifact) => `artifact.parentKey:${artifact.key}`)
    .sort(compareCodePoint);
  const extra = artifactKeys
    .filter((key) => !deploymentKeys.includes(key))
    .map((key) => `artifact:not-in-deployment:${key}`);
  const matched = [
    ...(conflicts.length === 0 && artifacts.length > 0 ? ["artifact.parentKey"] : []),
    ...(missing.length === 0 && extra.length === 0 ? ["deployment.artifactKeys"] : []),
  ];
  return {
    matched,
    missing: sortedUnique(missing),
    conflicts: sortedUnique([...conflicts, ...extra]),
    artifactKeys,
  };
}

/**
 * Correlate exact build/artifact/deployment identity links supplied by adapters
 * or bounded offline deployment metadata. Names and artifact aliases are never
 * used as a join key.
 */
export function correlateBuildArtifactDeployment(
  input: BuildArtifactDeploymentCorrelationInput,
): BuildArtifactDeploymentCorrelation {
  assertIdentity(input.build, "build", "build");
  assertIdentity(input.deployment, "deployment", "deployment");
  if (input.environment !== undefined)
    assertIdentity(input.environment, "environment", "environment");
  for (const [index, artifact] of input.artifacts.entries())
    assertIdentity(artifact, "artifact", `artifacts[${index}]`);

  const deploymentKeys = deploymentArtifactKeys(input.deployment);
  const set = validateArtifactSet(input.build, input.artifacts, deploymentKeys);
  const conflicts = [...set.conflicts];
  const missing = [...set.missing];
  if (input.deployment.parentKey !== input.deployment.environmentKey)
    conflicts.push("deployment.parentKey");
  if (input.environment === undefined) missing.push("environment");
  else if (input.environment.key !== input.deployment.environmentKey)
    conflicts.push("deployment.environmentKey");

  const allComplete = [input.build, ...input.artifacts, input.deployment, input.environment]
    .filter((value): value is NonNullable<typeof value> => value !== undefined)
    .every((value) => value.completeness === "complete");
  const linkComplete = conflicts.length === 0 && missing.length === 0;
  const outcome: BuildArtifactDeploymentOutcome =
    conflicts.length > 0
      ? "unknown"
      : linkComplete
        ? allComplete
          ? "exact"
          : "strong"
        : set.matched.length > 0
          ? "weak"
          : "unknown";
  const normalizedConflicts = sortedUnique(conflicts);
  const normalizedMissing = sortedUnique(missing);
  const matchedDimensions = sortedUnique([
    ...set.matched,
    ...(input.environment !== undefined && input.environment.key === input.deployment.environmentKey
      ? ["deployment.environmentKey"]
      : []),
    ...(input.build.parentKey !== undefined ? ["build.buildLineageKey"] : []),
  ]);
  const resultCompleteness = completeness([
    linkComplete,
    input.build.completeness === "complete",
    input.artifacts.length > 0 &&
      input.artifacts.every((artifact) => artifact.completeness === "complete"),
    input.deployment.completeness === "complete",
    input.environment?.completeness === "complete",
  ]);
  return {
    schemaVersion: BUILD_ARTIFACT_DEPLOYMENT_SCHEMA_VERSION,
    kind: "build-artifact-deployment",
    buildKey: input.build.key,
    buildLineageKey: input.build.parentKey ?? "unknown",
    artifactKeys: set.artifactKeys,
    deploymentKey: input.deployment.key,
    environmentKey: input.deployment.environmentKey,
    outcome,
    completeness: resultCompleteness,
    confidence: confidenceFor(outcome, allComplete && linkComplete),
    matchedDimensions,
    missing: normalizedMissing,
    conflicts: normalizedConflicts,
    evidenceIds: evidenceIds(input.evidenceIds),
    reason:
      outcome === "exact"
        ? "explicit build, artifact, deployment, and environment links agree"
        : outcome === "strong"
          ? "explicit lineage links agree but one or more identities are partial"
          : outcome === "weak"
            ? "some lineage links are present but deployment evidence is incomplete"
            : "build, artifact, deployment, or environment evidence conflicts or is missing",
  };
}

/**
 * Validate an explicit redeploy or rollback relationship. The function does
 * not infer ordering from timestamps or display labels: chronology is an
 * offline deployment-metadata fact supplied by the caller.
 */
export function correlateDeploymentRelationship(
  input: DeploymentRelationshipInput,
): DeploymentRelationshipCorrelation {
  assertIdentity(input.deployment, "deployment", "deployment");
  assertIdentity(input.relatedDeployment, "deployment", "relatedDeployment");
  if (input.deployment.key === input.relatedDeployment.key)
    throw new IdentityValidationError("deployment relationship endpoints must be distinct.");
  const deploymentKeys = deploymentArtifactKeys(input.deployment);
  const relatedKeys = deploymentArtifactKeys(input.relatedDeployment);
  const conflicts: string[] = [];
  const missing: string[] = [];
  if (input.deployment.environmentKey !== input.relatedDeployment.environmentKey)
    conflicts.push("environmentKey");
  if (!artifactSetEqual(deploymentKeys, relatedKeys)) conflicts.push("artifactKeys");
  if (input.deployment.artifactSetDigest !== input.relatedDeployment.artifactSetDigest)
    conflicts.push("artifactSetDigest");
  const complete =
    conflicts.length === 0 &&
    missing.length === 0 &&
    input.deployment.completeness === "complete" &&
    input.relatedDeployment.completeness === "complete";
  const outcome: BuildArtifactDeploymentOutcome =
    conflicts.length > 0 ? "unknown" : missing.length > 0 ? "weak" : complete ? "exact" : "strong";
  const normalizedMissing = sortedUnique(missing);
  const normalizedConflicts = sortedUnique(conflicts);
  return {
    schemaVersion: BUILD_ARTIFACT_DEPLOYMENT_SCHEMA_VERSION,
    kind: "deployment-relationship",
    deploymentKey: input.deployment.key,
    relatedDeploymentKey: input.relatedDeployment.key,
    environmentKey: input.deployment.environmentKey,
    relation: input.relation,
    outcome,
    completeness: completeness([conflicts.length === 0 && missing.length === 0, complete]),
    confidence: confidenceFor(outcome, complete),
    matchedDimensions: sortedUnique([
      ...(conflicts.includes("environmentKey") ? [] : ["environmentKey"]),
      ...(conflicts.includes("artifactKeys") ? [] : ["artifactKeys"]),
      ...(conflicts.includes("artifactSetDigest") ? [] : ["artifactSetDigest"]),
    ]),
    missing: normalizedMissing,
    conflicts: normalizedConflicts,
    evidenceIds: evidenceIds(input.evidenceIds),
    reason:
      outcome === "exact"
        ? `explicit ${input.relation} relationship has matching environment and artifact set`
        : "deployment relationship is incomplete or incompatible; chronology remains caller-supplied",
  };
}
