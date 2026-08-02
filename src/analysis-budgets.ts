import { performance } from "node:perf_hooks";

export type AnalysisBudgetKind =
  | "files"
  | "sourceBytes"
  | "artifacts"
  | "evidenceNodes"
  | "serializedBytes"
  | "wallTimeMs";

export interface AnalysisBudgetOptions {
  maxFiles?: number;
  maxSourceBytes?: number;
  maxArtifacts?: number;
  maxEvidenceNodes?: number;
  maxSerializedBytes?: number;
  maxWallTimeMs?: number;
}

export interface AnalysisBudgets {
  maxFiles: number;
  maxSourceBytes: number;
  maxArtifacts: number;
  maxEvidenceNodes: number;
  maxSerializedBytes: number;
  maxWallTimeMs: number;
}

export interface AnalysisBudgetUsage {
  files: number;
  sourceBytes: number;
  artifacts: number;
  evidenceNodes: number;
  serializedBytes: number;
}

export interface AnalysisBudgetExceeded {
  kind: AnalysisBudgetKind;
  limit: number;
}

export interface AnalysisBudgetReport {
  status: "complete" | "partial" | "unknown";
  limits: AnalysisBudgets;
  usage: AnalysisBudgetUsage;
  exceeded: AnalysisBudgetExceeded[];
}

export const DEFAULT_ANALYSIS_BUDGETS: AnalysisBudgets = Object.freeze({
  maxFiles: 10_000,
  maxSourceBytes: 50 * 1024 * 1024,
  maxArtifacts: 10_000,
  maxEvidenceNodes: 100_000,
  maxSerializedBytes: 50 * 1024 * 1024,
  maxWallTimeMs: 30_000,
});

const BUDGET_KINDS: readonly AnalysisBudgetKind[] = [
  "files",
  "sourceBytes",
  "artifacts",
  "evidenceNodes",
  "serializedBytes",
  "wallTimeMs",
];

function assertLimit(kind: AnalysisBudgetKind, value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new TypeError(`${kind} budget must be a non-negative safe integer.`);
}

export function resolveAnalysisBudgets(options: AnalysisBudgetOptions = {}): AnalysisBudgets {
  const result = { ...DEFAULT_ANALYSIS_BUDGETS };
  for (const kind of BUDGET_KINDS) {
    const option = `max${kind[0]!.toUpperCase()}${kind.slice(1)}` as keyof AnalysisBudgetOptions;
    const value = options[option];
    if (value !== undefined) {
      const budgetKind = kind;
      assertLimit(budgetKind, value);
      result[option as keyof AnalysisBudgets] = value;
    }
  }
  return Object.freeze(result);
}

export class AnalysisBudgetTracker {
  readonly limits: AnalysisBudgets;
  private readonly startedAt: number;
  private readonly now: () => number;
  private readonly usage: AnalysisBudgetUsage = {
    files: 0,
    sourceBytes: 0,
    artifacts: 0,
    evidenceNodes: 0,
    serializedBytes: 0,
  };
  private readonly exceeded = new Map<AnalysisBudgetKind, number>();

  constructor(limits: AnalysisBudgets, options: { now?: () => number; startedAt?: number } = {}) {
    this.limits = limits;
    this.now = options.now ?? (() => performance.now());
    this.startedAt = options.startedAt ?? this.now();
  }

  get elapsedMs(): number {
    return Math.max(0, this.now() - this.startedAt);
  }

  reserve(values: Partial<AnalysisBudgetUsage>): boolean {
    if (this.elapsedMs >= this.limits.maxWallTimeMs) {
      this.exceeded.set("wallTimeMs", this.limits.maxWallTimeMs);
      return false;
    }
    for (const kind of [
      "files",
      "sourceBytes",
      "artifacts",
      "evidenceNodes",
      "serializedBytes",
    ] as const) {
      const amount = values[kind] ?? 0;
      if (!Number.isSafeInteger(amount) || amount < 0)
        throw new TypeError(`${kind} usage must be a non-negative safe integer.`);
      if (
        this.usage[kind] + amount >
        this.limits[`max${kind[0]!.toUpperCase()}${kind.slice(1)}` as keyof AnalysisBudgets]
      ) {
        this.exceeded.set(
          kind,
          this.limits[`max${kind[0]!.toUpperCase()}${kind.slice(1)}` as keyof AnalysisBudgets],
        );
        return false;
      }
    }
    for (const kind of [
      "files",
      "sourceBytes",
      "artifacts",
      "evidenceNodes",
      "serializedBytes",
    ] as const)
      this.usage[kind] += values[kind] ?? 0;
    return true;
  }

  report(status: AnalysisBudgetReport["status"] = "complete"): AnalysisBudgetReport {
    const resolvedStatus = this.exceeded.size > 0 ? "partial" : status;
    return {
      status: resolvedStatus,
      limits: this.limits,
      usage: { ...this.usage },
      exceeded: [...this.exceeded.entries()]
        .map(([kind, limit]) => ({ kind, limit }))
        .sort((a, b) => a.kind.localeCompare(b.kind)),
    };
  }
}
