import { createHash } from "node:crypto";
import { compareCodePoint } from "./utils.js";

export const IDENTITY_SCHEMA_VERSION = 1 as const;
export type IdentitySchemaVersion = typeof IDENTITY_SCHEMA_VERSION;
export type IdentityKind =
  | "organization"
  | "application"
  | "container"
  | "adapter-target"
  | "build-lineage"
  | "build"
  | "artifact"
  | "environment"
  | "deployment"
  | "runtime-realm"
  | "runtime-instance";
export type IdentityCompleteness = "complete" | "partial" | "unknown";
export type IdentityConfidence = "exact" | "strong" | "weak" | "unknown";
export type IdentityTarget = "browser" | "ssr" | "worker" | "mobile" | "node" | "unknown";
export type IdentityRealm = "top-frame" | "iframe" | "worker" | "node" | "react-native" | "unknown";

export interface IdentityProvenance {
  source: "config" | "ci" | "compiler" | "artifact" | "deployment" | "runtime" | "unknown";
  evidenceIds: string[];
}

export interface SemanticIdentity {
  schemaVersion: IdentitySchemaVersion;
  kind: IdentityKind;
  key: string;
  aliases: string[];
  completeness: IdentityCompleteness;
  confidence: IdentityConfidence;
  provenance: IdentityProvenance;
  parentKey?: string;
  displayName?: string;
}

export interface OrganizationIdentity extends SemanticIdentity {
  kind: "organization";
  organizationId: string;
}
export interface ApplicationIdentity extends SemanticIdentity {
  kind: "application";
  organizationId: string;
  applicationId: string;
}
export interface ContainerIdentity extends SemanticIdentity {
  kind: "container";
  organizationId: string;
  applicationId: string;
  containerName: string;
}
export interface AdapterTargetIdentity extends SemanticIdentity {
  kind: "adapter-target";
  organizationId: string;
  applicationId: string;
  containerName: string;
  adapter: string;
  bundler: string;
  bundlerVersion?: string;
  target: IdentityTarget;
  mode?: string;
  buildEnvironment?: string;
}
export interface BuildLineageIdentity extends SemanticIdentity {
  kind: "build-lineage";
  organizationId: string;
  applicationId: string;
  adapterTargetKey: string;
  lane: string;
  target: IdentityTarget;
  environment: string;
}
export interface BuildIdentity extends SemanticIdentity {
  kind: "build";
  buildLineageKey: string;
  buildId: string;
  occurrenceId: string;
}
export interface ArtifactIdentity extends SemanticIdentity {
  kind: "artifact";
  buildKey: string;
  artifactKind: string;
  digest: string;
}
export interface EnvironmentIdentity extends SemanticIdentity {
  kind: "environment";
  organizationId: string;
  environment: string;
}
export interface DeploymentIdentity extends SemanticIdentity {
  kind: "deployment";
  environmentKey: string;
  deploymentId: string;
  artifactSetDigest: string;
  occurrenceId: string;
  artifactKeys: string[];
}
export interface RuntimeRealmIdentity extends SemanticIdentity {
  kind: "runtime-realm";
  deploymentKey: string;
  realm: IdentityRealm;
  realmId: string;
}
export interface RuntimeInstanceIdentity extends SemanticIdentity {
  kind: "runtime-instance";
  realmKey: string;
  runtimeInstanceId: string;
  runtimePackage: string;
  runtimeVersion: string;
  occurrenceId: string;
}

export type AnySemanticIdentity =
  | OrganizationIdentity
  | ApplicationIdentity
  | ContainerIdentity
  | AdapterTargetIdentity
  | BuildLineageIdentity
  | BuildIdentity
  | ArtifactIdentity
  | EnvironmentIdentity
  | DeploymentIdentity
  | RuntimeRealmIdentity
  | RuntimeInstanceIdentity;

type IdentityByKind = {
  organization: OrganizationIdentity;
  application: ApplicationIdentity;
  container: ContainerIdentity;
  "adapter-target": AdapterTargetIdentity;
  "build-lineage": BuildLineageIdentity;
  build: BuildIdentity;
  artifact: ArtifactIdentity;
  environment: EnvironmentIdentity;
  deployment: DeploymentIdentity;
  "runtime-realm": RuntimeRealmIdentity;
  "runtime-instance": RuntimeInstanceIdentity;
};

export interface OrganizationDimensions {
  organizationId: string;
}
export interface ApplicationDimensions {
  organizationId: string;
  applicationId: string;
}
export interface ContainerDimensions {
  organizationId: string;
  applicationId: string;
  containerName: string;
}
export interface AdapterTargetDimensions {
  organizationId: string;
  applicationId: string;
  containerName: string;
  adapter: string;
  bundler: string;
  bundlerVersion?: string;
  target: IdentityTarget;
  mode?: string;
  buildEnvironment?: string;
}
export interface BuildLineageDimensions {
  organizationId: string;
  applicationId: string;
  adapterTargetKey: string;
  lane: string;
  target: IdentityTarget;
  environment: string;
}
export interface BuildDimensions {
  buildLineageKey: string;
  buildId: string;
}
export interface ArtifactDimensions {
  buildKey: string;
  artifactKind: string;
  digest: string;
}
export interface EnvironmentDimensions {
  organizationId: string;
  environment: string;
}
export interface DeploymentDimensions {
  environmentKey: string;
  deploymentId: string;
  artifactSetDigest: string;
  artifactKeys: readonly string[];
}
export interface RuntimeRealmDimensions {
  deploymentKey: string;
  realm: IdentityRealm;
  realmId: string;
}
export interface RuntimeInstanceDimensions {
  realmKey: string;
  runtimeInstanceId: string;
  runtimePackage: string;
  runtimeVersion: string;
}
export interface IdentityDimensionsByKind {
  organization: OrganizationDimensions;
  application: ApplicationDimensions;
  container: ContainerDimensions;
  "adapter-target": AdapterTargetDimensions;
  "build-lineage": BuildLineageDimensions;
  build: BuildDimensions;
  artifact: ArtifactDimensions;
  environment: EnvironmentDimensions;
  deployment: DeploymentDimensions;
  "runtime-realm": RuntimeRealmDimensions;
  "runtime-instance": RuntimeInstanceDimensions;
}
export type IdentityDimensions = IdentityDimensionsByKind[IdentityKind];

const MAX_DIMENSIONS = 32;
const MAX_DIMENSION_LENGTH = 256;
const MAX_DIMENSION_BYTES = 4096;
const MAX_ALIASES = 16;
const MAX_ALIAS_LENGTH = 128;
const MAX_ALIAS_BYTES = 1024;
const MAX_EVIDENCE_IDS = 32;
const MAX_EVIDENCE_ID_LENGTH = 128;
const MAX_UNKNOWN_SOURCE_ID = 128;
const ID_KEY = /^mfid:v1:[a-z-]+:[a-f0-9]{24}$/;
const ABSOLUTE_PATH = /^(?:[A-Za-z]:[\\/]|\\\\|\/)/;
const URL_VALUE = /[a-z][a-z\d+.-]*:\/\//i;
const SENSITIVE_QUERY =
  /[?&](?:token|sig|signature|expires|auth|authorization|password|secret|credential|session|key)(?:=|&|$)/i;
const TIMESTAMP_VALUE = /^(?:\d{4}-\d{2}-\d{2}(?:[Tt ]|$)|\d{10,13})/;
const PROCESS_SESSION_VALUE = /^(?:process|session|tab|pid|sid)(?:[-_:]|$)/i;
const UNSAFE_NAME =
  /(?:cwd|workspaceRoot|accessToken|authorizationHeader|secret|token|password|cookie|privateKey|signedUrl)/i;
const DIGEST = /^(?:sha256:)?[a-f0-9]{64}$/;
const DIMENSION_METADATA: Record<
  IdentityKind,
  { allowed: readonly string[]; required: readonly string[] }
> = {
  organization: { allowed: ["organizationId"], required: ["organizationId"] },
  application: {
    allowed: ["organizationId", "applicationId"],
    required: ["organizationId", "applicationId"],
  },
  container: {
    allowed: ["organizationId", "applicationId", "containerName"],
    required: ["organizationId", "applicationId", "containerName"],
  },
  "adapter-target": {
    allowed: [
      "organizationId",
      "applicationId",
      "containerName",
      "adapter",
      "bundler",
      "bundlerVersion",
      "target",
      "mode",
      "buildEnvironment",
    ],
    required: ["organizationId", "applicationId", "containerName", "adapter", "bundler", "target"],
  },
  "build-lineage": {
    allowed: [
      "organizationId",
      "applicationId",
      "adapterTargetKey",
      "lane",
      "target",
      "environment",
    ],
    required: [
      "organizationId",
      "applicationId",
      "adapterTargetKey",
      "lane",
      "target",
      "environment",
    ],
  },
  build: {
    allowed: ["buildLineageKey", "buildId"],
    required: ["buildLineageKey", "buildId"],
  },
  artifact: {
    allowed: ["buildKey", "artifactKind", "digest"],
    required: ["buildKey", "artifactKind", "digest"],
  },
  environment: {
    allowed: ["organizationId", "environment"],
    required: ["organizationId", "environment"],
  },
  deployment: {
    allowed: ["environmentKey", "deploymentId", "artifactSetDigest", "artifactKeys"],
    required: ["environmentKey", "deploymentId", "artifactSetDigest", "artifactKeys"],
  },
  "runtime-realm": {
    allowed: ["deploymentKey", "realm", "realmId"],
    required: ["deploymentKey", "realm", "realmId"],
  },
  "runtime-instance": {
    allowed: ["realmKey", "runtimeInstanceId", "runtimePackage", "runtimeVersion"],
    required: ["realmKey", "runtimeInstanceId", "runtimePackage", "runtimeVersion"],
  },
};
const TARGETS = new Set<IdentityTarget>(["browser", "ssr", "worker", "mobile", "node", "unknown"]);
const REALMS = new Set<IdentityRealm>([
  "top-frame",
  "iframe",
  "worker",
  "node",
  "react-native",
  "unknown",
]);
const COMPLETENESS = new Set<IdentityCompleteness>(["complete", "partial", "unknown"]);
const CONFIDENCE = new Set<IdentityConfidence>(["exact", "strong", "weak", "unknown"]);
const PROVENANCE_SOURCES = new Set<IdentityProvenance["source"]>([
  "config",
  "ci",
  "compiler",
  "artifact",
  "deployment",
  "runtime",
  "unknown",
]);

export class IdentityValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdentityValidationError";
  }
}

function bytes(value: string): number {
  return Buffer.byteLength(value, "utf8");
}
function validateSafeValue(value: string, label: string): void {
  if (value.length === 0) throw new IdentityValidationError(`${label} cannot be empty.`);
  if (ABSOLUTE_PATH.test(value) || URL_VALUE.test(value) || SENSITIVE_QUERY.test(value))
    throw new IdentityValidationError(`Unsafe value in ${label}.`);
  if (TIMESTAMP_VALUE.test(value) || PROCESS_SESSION_VALUE.test(value))
    throw new IdentityValidationError(`Volatile value in ${label}.`);
}

function validateEnum<T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>,
  label: string,
): void {
  if (typeof value !== "string" || !allowed.has(value as T))
    throw new IdentityValidationError(`${label} must be a supported enum value.`);
}

function validateDimensions<K extends IdentityKind>(
  kind: K,
  dimensions: IdentityDimensionsByKind[K],
): void {
  const entries = Object.entries(dimensions);
  const metadata = DIMENSION_METADATA[kind];
  const allowed = new Set(metadata.allowed);
  if (entries.length === 0)
    throw new IdentityValidationError(`${kind} dimensions cannot be empty.`);
  if (entries.length > MAX_DIMENSIONS)
    throw new IdentityValidationError("Identity dimensions exceed maxProperties (32).");
  let total = 0;
  for (const [name, value] of entries) {
    if (!allowed.has(name))
      throw new IdentityValidationError(`Unsupported or unsafe ${kind} dimension: ${name}.`);
    if (UNSAFE_NAME.test(name))
      throw new IdentityValidationError(`Unsafe identity dimension name: ${name}.`);
    if (typeof value !== "string" && !Array.isArray(value))
      throw new IdentityValidationError(
        `${kind} dimension ${name} must be a string or string array.`,
      );
    if (value === undefined || value.length === 0)
      throw new IdentityValidationError(`${kind} dimension ${name} cannot be empty.`);
    const values = typeof value === "string" ? [value] : value;
    if (values.length > MAX_EVIDENCE_IDS)
      throw new IdentityValidationError(`${kind} dimension ${name} exceeds maxItems (32).`);
    for (const item of values) {
      if (typeof item !== "string")
        throw new IdentityValidationError(`${kind} dimension ${name} must contain strings.`);
      if (item.length > MAX_DIMENSION_LENGTH)
        throw new IdentityValidationError(`${kind} dimension ${name} exceeds maxLength (256).`);
      validateSafeValue(item, `${kind} dimension ${name}`);
      if ((name === "digest" || name === "artifactSetDigest") && !DIGEST.test(item))
        throw new IdentityValidationError(`${kind} dimension ${name} must be a sha256 digest.`);
      if (name === "target") validateEnum(item, TARGETS, "target");
      if (name === "realm") validateEnum(item, REALMS, "realm");
    }
    total += bytes(name) + values.reduce((sum, item) => sum + bytes(item), 0);
  }
  if (total > MAX_DIMENSION_BYTES)
    throw new IdentityValidationError("Identity dimensions exceed maxBytes (4096).");
  for (const required of metadata.required) {
    if (!(required in dimensions) || dimensions[required as keyof typeof dimensions] === undefined)
      throw new IdentityValidationError(`${kind} requires dimension ${required}.`);
  }
  validateReferenceDimensions(kind, dimensions);
}

function validateKey(value: string, name: string, expectedKind?: IdentityKind): void {
  if (!ID_KEY.test(value) || (expectedKind && !value.startsWith(`mfid:v1:${expectedKind}:`)))
    throw new IdentityValidationError(`${name} must be a semantic identity key.`);
}

function expectedParentKind(kind: IdentityKind): IdentityKind | undefined {
  switch (kind) {
    case "organization":
      return undefined;
    case "application":
      return "organization";
    case "container":
      return "application";
    case "adapter-target":
      return "container";
    case "build-lineage":
      return "adapter-target";
    case "build":
      return "build-lineage";
    case "artifact":
      return "build";
    case "environment":
      return "organization";
    case "deployment":
      return "environment";
    case "runtime-realm":
      return "deployment";
    case "runtime-instance":
      return "runtime-realm";
  }
}

function validateReferenceDimensions<K extends IdentityKind>(
  kind: K,
  dimensions: IdentityDimensionsByKind[K],
): void {
  const refs: Array<[string, string, IdentityKind]> = [];
  if (kind === "build-lineage")
    refs.push([
      "adapterTargetKey",
      (dimensions as BuildLineageDimensions).adapterTargetKey,
      "adapter-target",
    ]);
  if (kind === "build")
    refs.push([
      "buildLineageKey",
      (dimensions as BuildDimensions).buildLineageKey,
      "build-lineage",
    ]);
  if (kind === "artifact")
    refs.push(["buildKey", (dimensions as ArtifactDimensions).buildKey, "build"]);
  if (kind === "deployment")
    refs.push([
      "environmentKey",
      (dimensions as DeploymentDimensions).environmentKey,
      "environment",
    ]);
  if (kind === "runtime-realm")
    refs.push([
      "deploymentKey",
      (dimensions as RuntimeRealmDimensions).deploymentKey,
      "deployment",
    ]);
  if (kind === "runtime-instance")
    refs.push(["realmKey", (dimensions as RuntimeInstanceDimensions).realmKey, "runtime-realm"]);
  for (const [name, value, expected] of refs) validateKey(value, name, expected);
  if (kind === "deployment")
    for (const value of (dimensions as DeploymentDimensions).artifactKeys)
      validateKey(value, "artifactKeys", "artifact");
}

function validateParentReference<K extends IdentityKind>(
  kind: K,
  dimensions: IdentityDimensionsByKind[K],
  parentKey: string | undefined,
): void {
  if (kind === "organization") {
    if (parentKey !== undefined)
      throw new IdentityValidationError("organization cannot have parentKey.");
    return;
  }
  if (parentKey === undefined) throw new IdentityValidationError(`${kind} requires parentKey.`);
  const reference =
    kind === "build-lineage"
      ? (dimensions as BuildLineageDimensions).adapterTargetKey
      : kind === "build"
        ? (dimensions as BuildDimensions).buildLineageKey
        : kind === "artifact"
          ? (dimensions as ArtifactDimensions).buildKey
          : kind === "deployment"
            ? (dimensions as DeploymentDimensions).environmentKey
            : kind === "runtime-realm"
              ? (dimensions as RuntimeRealmDimensions).deploymentKey
              : kind === "runtime-instance"
                ? (dimensions as RuntimeInstanceDimensions).realmKey
                : undefined;
  if (reference !== undefined && reference !== parentKey)
    throw new IdentityValidationError(`${kind} reference dimension must equal parentKey.`);
}

function canonicalDimensions<K extends IdentityKind>(
  kind: K,
  dimensions: IdentityDimensionsByKind[K],
  parentKey?: string,
): string {
  validateDimensions(kind, dimensions);
  validateParentReference(kind, dimensions, parentKey);
  if (parentKey !== undefined) validateKey(parentKey, "parentKey", expectedParentKind(kind));
  return JSON.stringify({
    kind,
    ...(parentKey ? { parentKey } : {}),
    dimensions: normalizeDimensions(dimensions),
  });
}

function normalizeDimensions<K extends IdentityKind>(
  dimensions: IdentityDimensionsByKind[K],
): IdentityDimensionsByKind[K] {
  return Object.fromEntries(
    Object.entries(dimensions)
      .sort(([left], [right]) => compareCodePoint(left, right))
      .map(([key, value]) => [
        key,
        Array.isArray(value) ? [...new Set(value)].sort(compareCodePoint) : value,
      ]),
  ) as IdentityDimensionsByKind[K];
}

/** Build a stable key. Every accepted dimension is key material; none are silently dropped. */
export function canonicalIdentityKey<K extends IdentityKind>(
  kind: K,
  dimensions: IdentityDimensionsByKind[K],
  parentKey?: string,
): string {
  const digest = createHash("sha256")
    .update(canonicalDimensions(kind, dimensions, parentKey))
    .digest("hex")
    .slice(0, 24);
  return `mfid:v${IDENTITY_SCHEMA_VERSION}:${kind}:${digest}`;
}

export interface IdentityOptions {
  aliases?: string[];
  completeness?: IdentityCompleteness;
  confidence?: IdentityConfidence;
  provenance?: Partial<IdentityProvenance>;
  displayName?: string;
}
export type IdentityChildOptions = IdentityOptions & { parentKey: string };

function common<K extends IdentityKind>(
  kind: K,
  dimensions: IdentityDimensionsByKind[K],
  options: IdentityOptions,
  parentKey?: string,
): SemanticIdentity {
  const hasUnknown = Object.values(dimensions).some((value) =>
    Array.isArray(value) ? value.some((item) => item === "unknown") : value === "unknown",
  );
  if (options.completeness !== undefined)
    validateEnum(options.completeness, COMPLETENESS, "completeness");
  if (options.confidence !== undefined) validateEnum(options.confidence, CONFIDENCE, "confidence");
  if (options.provenance?.source !== undefined)
    validateEnum(options.provenance.source, PROVENANCE_SOURCES, "provenance.source");
  if (hasUnknown && (options.completeness === "complete" || options.confidence === "strong"))
    throw new IdentityValidationError("Unknown identity dimensions cannot be complete/strong.");
  const aliases = options.aliases ?? [];
  if (
    aliases.length > MAX_ALIASES ||
    aliases.some(
      (alias) => typeof alias !== "string" || alias.length === 0 || alias.length > MAX_ALIAS_LENGTH,
    )
  )
    throw new IdentityValidationError("Identity aliases exceed maxItems (16) or maxLength (128).");
  if (aliases.reduce((total, alias) => total + bytes(alias), 0) > MAX_ALIAS_BYTES)
    throw new IdentityValidationError("Identity aliases exceed maxBytes (1024).");
  for (const alias of aliases) validateSafeValue(alias, "identity alias");
  const evidenceIds = options.provenance?.evidenceIds ?? [];
  if (
    evidenceIds.length > MAX_EVIDENCE_IDS ||
    evidenceIds.some(
      (id) => typeof id !== "string" || id.length === 0 || id.length > MAX_EVIDENCE_ID_LENGTH,
    )
  )
    throw new IdentityValidationError(
      "Identity evidenceIds exceed maxItems (32) or maxLength (128).",
    );
  for (const id of evidenceIds) validateSafeValue(id, "identity evidence ID");
  if (evidenceIds.reduce((total, id) => total + bytes(id), 0) > MAX_DIMENSION_BYTES)
    throw new IdentityValidationError("Identity evidenceIds exceed maxBytes (4096).");
  if (options.displayName !== undefined) {
    if (options.displayName.length > MAX_DIMENSION_LENGTH)
      throw new IdentityValidationError("displayName exceeds maxLength (256).");
    validateSafeValue(options.displayName, "displayName");
  }
  const identity: SemanticIdentity = {
    schemaVersion: IDENTITY_SCHEMA_VERSION,
    kind,
    key: canonicalIdentityKey(kind, dimensions, parentKey),
    aliases: [...new Set(aliases)].sort(compareCodePoint),
    completeness: options.completeness ?? (hasUnknown ? "unknown" : "complete"),
    confidence: options.confidence ?? (hasUnknown ? "unknown" : "strong"),
    provenance: {
      source: options.provenance?.source ?? "unknown",
      evidenceIds: [...new Set(evidenceIds)].sort(compareCodePoint),
    },
  };
  Object.assign(identity, normalizeDimensions(dimensions));
  if (parentKey !== undefined) identity.parentKey = parentKey;
  if (options.displayName !== undefined) identity.displayName = options.displayName;
  return identity;
}

export type CreateIdentityOptions =
  | (IdentityOptions & {
      kind: "organization";
      dimensions: OrganizationDimensions;
      parentKey?: never;
    })
  | {
      [K in Exclude<IdentityKind, "organization">]: IdentityChildOptions & {
        kind: K;
        dimensions: IdentityDimensionsByKind[K];
      };
    }[Exclude<IdentityKind, "organization">];

/** Generic escape hatch with the same validation as kind-specific constructors. */
export function createIdentity(
  options: Extract<CreateIdentityOptions, { kind: "organization" }>,
): IdentityByKind["organization"];
export function createIdentity(
  options: Extract<CreateIdentityOptions, { kind: "application" }>,
): IdentityByKind["application"];
export function createIdentity(
  options: Extract<CreateIdentityOptions, { kind: "container" }>,
): IdentityByKind["container"];
export function createIdentity(
  options: Extract<CreateIdentityOptions, { kind: "adapter-target" }>,
): IdentityByKind["adapter-target"];
export function createIdentity(
  options: Extract<CreateIdentityOptions, { kind: "build-lineage" }>,
): IdentityByKind["build-lineage"];
export function createIdentity(
  options: Extract<CreateIdentityOptions, { kind: "build" }>,
): IdentityByKind["build"];
export function createIdentity(
  options: Extract<CreateIdentityOptions, { kind: "artifact" }>,
): IdentityByKind["artifact"];
export function createIdentity(
  options: Extract<CreateIdentityOptions, { kind: "environment" }>,
): IdentityByKind["environment"];
export function createIdentity(
  options: Extract<CreateIdentityOptions, { kind: "deployment" }>,
): IdentityByKind["deployment"];
export function createIdentity(
  options: Extract<CreateIdentityOptions, { kind: "runtime-realm" }>,
): IdentityByKind["runtime-realm"];
export function createIdentity(
  options: Extract<CreateIdentityOptions, { kind: "runtime-instance" }>,
): IdentityByKind["runtime-instance"];
export function createIdentity(options: CreateIdentityOptions): SemanticIdentity {
  if (options.kind !== "organization" && typeof options.parentKey !== "string")
    throw new IdentityValidationError("child identity requires parentKey.");
  const identity = common(options.kind, options.dimensions, options, options.parentKey);
  switch (options.kind) {
    case "build":
      return { ...identity, occurrenceId: options.dimensions.buildId } as BuildIdentity;
    case "deployment":
      return { ...identity, occurrenceId: options.dimensions.deploymentId } as DeploymentIdentity;
    case "runtime-instance":
      return {
        ...identity,
        occurrenceId: options.dimensions.runtimeInstanceId,
      } as RuntimeInstanceIdentity;
    default:
      return identity;
  }
}

function child<K extends IdentityKind>(
  kind: K,
  dimensions: IdentityDimensionsByKind[K],
  options: IdentityChildOptions,
): SemanticIdentity {
  if (typeof options.parentKey !== "string")
    throw new IdentityValidationError(`${kind} requires parentKey.`);
  return common(kind, dimensions, options, options.parentKey);
}

export function createOrganizationIdentity(
  dimensions: OrganizationDimensions,
  options: IdentityOptions = {},
): OrganizationIdentity {
  return common("organization", dimensions, options) as OrganizationIdentity;
}
export function createApplicationIdentity(
  dimensions: ApplicationDimensions,
  options: IdentityChildOptions,
): ApplicationIdentity {
  return child("application", dimensions, options) as ApplicationIdentity;
}
export function createContainerIdentity(
  dimensions: ContainerDimensions,
  options: IdentityChildOptions,
): ContainerIdentity {
  return child("container", dimensions, options) as ContainerIdentity;
}
export function createAdapterTargetIdentity(
  dimensions: AdapterTargetDimensions,
  options: IdentityChildOptions,
): AdapterTargetIdentity {
  return child("adapter-target", dimensions, options) as AdapterTargetIdentity;
}
export function createBuildLineageIdentity(
  dimensions: BuildLineageDimensions,
  options: IdentityChildOptions,
): BuildLineageIdentity {
  return child("build-lineage", dimensions, options) as BuildLineageIdentity;
}
export function createBuildIdentity(
  dimensions: BuildDimensions,
  options: IdentityChildOptions,
): BuildIdentity {
  return {
    ...child("build", dimensions, options),
    occurrenceId: dimensions.buildId,
  } as BuildIdentity;
}
export function createArtifactIdentity(
  dimensions: ArtifactDimensions,
  options: IdentityChildOptions,
): ArtifactIdentity {
  return child("artifact", dimensions, options) as ArtifactIdentity;
}
export function createEnvironmentIdentity(
  dimensions: EnvironmentDimensions,
  options: IdentityChildOptions,
): EnvironmentIdentity {
  return child("environment", dimensions, options) as EnvironmentIdentity;
}
export function createDeploymentIdentity(
  dimensions: DeploymentDimensions,
  options: IdentityChildOptions,
): DeploymentIdentity {
  return {
    ...child("deployment", dimensions, options),
    occurrenceId: dimensions.deploymentId,
  } as DeploymentIdentity;
}
export function createRuntimeRealmIdentity(
  dimensions: RuntimeRealmDimensions,
  options: IdentityChildOptions,
): RuntimeRealmIdentity {
  return child("runtime-realm", dimensions, options) as RuntimeRealmIdentity;
}
export function createRuntimeInstanceIdentity(
  dimensions: RuntimeInstanceDimensions,
  options: IdentityChildOptions,
): RuntimeInstanceIdentity {
  return {
    ...child("runtime-instance", dimensions, options),
    occurrenceId: dimensions.runtimeInstanceId,
  } as RuntimeInstanceIdentity;
}

/** Unknown nodes are source-scoped but never retain raw source secrets or paths. */
export function unknownIdentity(kind: IdentityKind, sourceId: string): SemanticIdentity {
  if (
    sourceId.length === 0 ||
    sourceId.length > MAX_UNKNOWN_SOURCE_ID ||
    UNSAFE_NAME.test(sourceId)
  )
    throw new IdentityValidationError("Unknown identity sourceId must be a bounded opaque ID.");
  validateSafeValue(sourceId, "unknown identity sourceId");
  const digest = createHash("sha256").update(sourceId).digest("hex").slice(0, 24);
  const unknownSource = `unknown:${digest}`;
  const parentKind = expectedParentKind(kind);
  const parentKey = parentKind ? unknownIdentity(parentKind, sourceId).key : undefined;
  const options: IdentityOptions = {
    completeness: "unknown",
    confidence: "unknown",
    provenance: { source: "unknown", evidenceIds: [] },
    displayName: "unknown",
  };
  const dimensions = unknownDimensions(kind, unknownSource, parentKey);
  switch (kind) {
    case "organization":
      return createOrganizationIdentity(dimensions as OrganizationDimensions, options);
    case "application":
      return createApplicationIdentity(dimensions as ApplicationDimensions, {
        ...options,
        parentKey: parentKey!,
      });
    case "container":
      return createContainerIdentity(dimensions as ContainerDimensions, {
        ...options,
        parentKey: parentKey!,
      });
    case "adapter-target":
      return createAdapterTargetIdentity(dimensions as AdapterTargetDimensions, {
        ...options,
        parentKey: parentKey!,
      });
    case "build-lineage":
      return createBuildLineageIdentity(dimensions as BuildLineageDimensions, {
        ...options,
        parentKey: parentKey!,
      });
    case "build":
      return createBuildIdentity(dimensions as BuildDimensions, {
        ...options,
        parentKey: parentKey!,
      });
    case "artifact":
      return createArtifactIdentity(dimensions as ArtifactDimensions, {
        ...options,
        parentKey: parentKey!,
      });
    case "environment":
      return createEnvironmentIdentity(dimensions as EnvironmentDimensions, {
        ...options,
        parentKey: parentKey!,
      });
    case "deployment":
      return createDeploymentIdentity(dimensions as DeploymentDimensions, {
        ...options,
        parentKey: parentKey!,
      });
    case "runtime-realm":
      return createRuntimeRealmIdentity(dimensions as RuntimeRealmDimensions, {
        ...options,
        parentKey: parentKey!,
      });
    case "runtime-instance":
      return createRuntimeInstanceIdentity(dimensions as RuntimeInstanceDimensions, {
        ...options,
        parentKey: parentKey!,
      });
  }
}

function unknownDimensions<K extends IdentityKind>(
  kind: K,
  sourceId: string,
  parentKey?: string,
): IdentityDimensionsByKind[K] {
  const key = parentKey ?? sourceId;
  const digest = `sha256:${sourceId.replace("unknown:", "").repeat(3).slice(0, 64)}`;
  switch (kind) {
    case "organization":
      return { organizationId: sourceId } as IdentityDimensionsByKind[K];
    case "application":
      return { organizationId: sourceId, applicationId: sourceId } as IdentityDimensionsByKind[K];
    case "container":
      return {
        organizationId: sourceId,
        applicationId: sourceId,
        containerName: sourceId,
      } as unknown as IdentityDimensionsByKind[K];
    case "adapter-target":
      return {
        organizationId: sourceId,
        applicationId: sourceId,
        containerName: sourceId,
        adapter: "unknown",
        bundler: "unknown",
        target: "unknown",
      } as IdentityDimensionsByKind[K];
    case "build-lineage":
      return {
        organizationId: sourceId,
        applicationId: sourceId,
        adapterTargetKey: key,
        lane: sourceId,
        target: "unknown",
        environment: sourceId,
      } as IdentityDimensionsByKind[K];
    case "build":
      return { buildLineageKey: key, buildId: sourceId } as IdentityDimensionsByKind[K];
    case "artifact":
      return {
        buildKey: key,
        artifactKind: "unknown",
        digest,
      } as IdentityDimensionsByKind[K];
    case "environment":
      return { organizationId: sourceId, environment: sourceId } as IdentityDimensionsByKind[K];
    case "deployment":
      return {
        environmentKey: key,
        deploymentId: sourceId,
        artifactSetDigest: digest,
        artifactKeys: [unknownIdentity("artifact", sourceId).key],
      } as unknown as IdentityDimensionsByKind[K];
    case "runtime-realm":
      return {
        deploymentKey: key,
        realm: "unknown",
        realmId: sourceId,
      } as IdentityDimensionsByKind[K];
    case "runtime-instance":
      return {
        realmKey: key,
        runtimeInstanceId: sourceId,
        runtimePackage: "unknown",
        runtimeVersion: "unknown",
      } as IdentityDimensionsByKind[K];
  }
}
