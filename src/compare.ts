import fs from "node:fs/promises";
import path from "node:path";
import {
  loadManifestContract,
  type ManifestContract,
  type ManifestContractShared,
  type ProbeOptions,
} from "./probe.js";
import type { OutputFormat } from "./types.js";
import { stableStringify } from "./utils.js";

export type ManifestCompareField =
  | "name"
  | "exposes"
  | "shared"
  | "publicPath"
  | "remoteEntry"
  | "remoteEntryStatus";

export interface ManifestCompareSide {
  url: string;
  name?: string;
  publicPath?: string;
  remoteEntry?: string;
  remoteEntryStatus?: number;
  exposes: string[];
  shared: ManifestContractShared[];
}

export interface ManifestCompareDiff {
  field: ManifestCompareField;
  baselineUrl: string;
  candidateUrl: string;
  baseline: unknown;
  candidate: unknown;
  message: string;
}

export interface ManifestCompareResult {
  schemaVersion: 1;
  equal: boolean;
  baseline: ManifestCompareSide;
  candidates: ManifestCompareSide[];
  diffs: ManifestCompareDiff[];
}

export type CompareManifestsOptions = ProbeOptions;

function toSide(contract: ManifestContract): ManifestCompareSide {
  return {
    url: contract.url,
    exposes: contract.exposes,
    shared: contract.shared,
    ...(contract.name ? { name: contract.name } : {}),
    ...(contract.publicPath ? { publicPath: contract.publicPath } : {}),
    ...(contract.remoteEntry ? { remoteEntry: contract.remoteEntry } : {}),
    ...(contract.remoteEntryProbe ? { remoteEntryStatus: contract.remoteEntryProbe.status } : {}),
  };
}

function sharedSignature(entries: ManifestContractShared[]): string[] {
  return entries.map((entry) => (entry.version ? `${entry.name}@${entry.version}` : entry.name));
}

function sameStringList(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function diffField(
  field: ManifestCompareField,
  baseline: ManifestCompareSide,
  candidate: ManifestCompareSide,
  baselineValue: unknown,
  candidateValue: unknown,
  message: string,
): ManifestCompareDiff {
  return {
    field,
    baselineUrl: baseline.url,
    candidateUrl: candidate.url,
    baseline: baselineValue,
    candidate: candidateValue,
    message,
  };
}

function compareSides(
  baseline: ManifestCompareSide,
  candidate: ManifestCompareSide,
  includeRemoteEntryStatus: boolean,
): ManifestCompareDiff[] {
  const diffs: ManifestCompareDiff[] = [];
  if ((baseline.name ?? "") !== (candidate.name ?? "")) {
    diffs.push(
      diffField(
        "name",
        baseline,
        candidate,
        baseline.name ?? null,
        candidate.name ?? null,
        `name differs: ${baseline.name ?? "(none)"} vs ${candidate.name ?? "(none)"}`,
      ),
    );
  }
  if (!sameStringList(baseline.exposes, candidate.exposes)) {
    diffs.push(
      diffField(
        "exposes",
        baseline,
        candidate,
        baseline.exposes,
        candidate.exposes,
        `exposes differ (${baseline.exposes.length} vs ${candidate.exposes.length})`,
      ),
    );
  }
  const baselineShared = sharedSignature(baseline.shared);
  const candidateShared = sharedSignature(candidate.shared);
  if (!sameStringList(baselineShared, candidateShared)) {
    diffs.push(
      diffField(
        "shared",
        baseline,
        candidate,
        baseline.shared,
        candidate.shared,
        `shared differ (${baselineShared.length} vs ${candidateShared.length})`,
      ),
    );
  }
  if ((baseline.publicPath ?? "") !== (candidate.publicPath ?? "")) {
    diffs.push(
      diffField(
        "publicPath",
        baseline,
        candidate,
        baseline.publicPath ?? null,
        candidate.publicPath ?? null,
        `publicPath differs: ${baseline.publicPath ?? "(none)"} vs ${candidate.publicPath ?? "(none)"}`,
      ),
    );
  }
  if ((baseline.remoteEntry ?? "") !== (candidate.remoteEntry ?? "")) {
    diffs.push(
      diffField(
        "remoteEntry",
        baseline,
        candidate,
        baseline.remoteEntry ?? null,
        candidate.remoteEntry ?? null,
        `remoteEntry differs: ${baseline.remoteEntry ?? "(none)"} vs ${candidate.remoteEntry ?? "(none)"}`,
      ),
    );
  }
  if (includeRemoteEntryStatus) {
    const left = baseline.remoteEntryStatus;
    const right = candidate.remoteEntryStatus;
    if (left !== right) {
      diffs.push(
        diffField(
          "remoteEntryStatus",
          baseline,
          candidate,
          left ?? null,
          right ?? null,
          `remoteEntry status differs: ${left ?? "(none)"} vs ${right ?? "(none)"}`,
        ),
      );
    }
  }
  return diffs;
}

/**
 * Compare one or more deployed MF manifests.
 * The first URL is the baseline; each remaining URL is a candidate.
 * Reuses probe SSRF / HTTPS / size / redirect policy. Never downloads or evals remote JS.
 */
export async function compareManifests(
  urls: string[],
  options: CompareManifestsOptions = {},
): Promise<ManifestCompareResult> {
  if (urls.length < 1) throw new Error("compare needs at least one manifest URL.");
  const contracts: ManifestContract[] = [];
  for (const url of urls) {
    contracts.push(await loadManifestContract(url, options));
  }
  const sides = contracts.map(toSide);
  const baseline = sides[0]!;
  const candidates = sides.slice(1);
  const includeRemoteEntryStatus = options.remoteEntry === true;
  const diffs: ManifestCompareDiff[] = [];
  for (const candidate of candidates) {
    diffs.push(...compareSides(baseline, candidate, includeRemoteEntryStatus));
  }
  diffs.sort(
    (left, right) =>
      left.field.localeCompare(right.field) ||
      left.candidateUrl.localeCompare(right.candidateUrl) ||
      left.message.localeCompare(right.message),
  );
  return {
    schemaVersion: 1,
    equal: diffs.length === 0,
    baseline,
    candidates,
    diffs,
  };
}

export function formatCompareTerminal(result: ManifestCompareResult): string {
  const lines = [
    `Compared ${1 + result.candidates.length} manifest${1 + result.candidates.length === 1 ? "" : "s"}`,
    `Baseline: ${result.baseline.url}`,
  ];
  if (result.candidates.length === 0) {
    lines.push("No candidate URLs; nothing to diff.");
    return lines.join("\n");
  }
  for (const candidate of result.candidates) lines.push(`Candidate: ${candidate.url}`);
  if (result.equal) {
    lines.push("No material differences.");
    return lines.join("\n");
  }
  lines.push(`${result.diffs.length} difference${result.diffs.length === 1 ? "" : "s"}:`);
  for (const diff of result.diffs) {
    lines.push(`- [${diff.field}] ${diff.message}`);
    lines.push(`  baseline: ${diff.baselineUrl}`);
    lines.push(`  candidate: ${diff.candidateUrl}`);
  }
  return lines.join("\n");
}

export function compareToSarif(result: ManifestCompareResult): Record<string, unknown> {
  const fields = [...new Set(result.diffs.map((diff) => diff.field))].sort();
  return {
    version: "2.1.0",
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    runs: [
      {
        tool: {
          driver: {
            name: "MFDoctor",
            rules: fields.map((field) => ({
              id: `compare/${field}`,
              shortDescription: { text: `Manifest ${field} drift` },
            })),
          },
        },
        results: result.diffs.map((diff) => ({
          ruleId: `compare/${diff.field}`,
          level: "error",
          message: { text: diff.message },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: diff.candidateUrl },
              },
            },
          ],
          properties: {
            baselineUrl: diff.baselineUrl,
            candidateUrl: diff.candidateUrl,
            baseline: diff.baseline,
            candidate: diff.candidate,
          },
        })),
      },
    ],
  };
}

export async function writeCompareReports(
  result: ManifestCompareResult,
  directory: string,
  formats: OutputFormat[],
): Promise<void> {
  await fs.mkdir(directory, { recursive: true });
  if (formats.includes("json"))
    await fs.writeFile(path.join(directory, "compare.json"), stableStringify(result, 2) + "\n");
  if (formats.includes("sarif"))
    await fs.writeFile(
      path.join(directory, "compare.sarif"),
      stableStringify(compareToSarif(result), 2) + "\n",
    );
  if (formats.includes("terminal")) process.stdout.write(formatCompareTerminal(result) + "\n");
}
