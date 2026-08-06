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

export interface EvidenceBudgetMeasurement {
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

  get usageSnapshot(): AnalysisBudgetUsage {
    return { ...this.usage };
  }

  /** Check the only budget that can expire while a value is being processed. */
  checkWallTime(): boolean {
    if (this.elapsedMs < this.limits.maxWallTimeMs) return true;
    this.exceeded.set("wallTimeMs", this.limits.maxWallTimeMs);
    return false;
  }

  reserveEvidence(measurement: EvidenceBudgetMeasurement): boolean {
    return this.reserve(measurement);
  }

  reserve(values: Partial<AnalysisBudgetUsage>): boolean {
    const exceeded: Array<[AnalysisBudgetKind, number]> = [];
    if (!this.checkWallTime()) {
      exceeded.push(["wallTimeMs", this.limits.maxWallTimeMs]);
    }
    const usageKinds = [
      "files",
      "sourceBytes",
      "artifacts",
      "evidenceNodes",
      "serializedBytes",
    ] as const;
    for (const kind of usageKinds) {
      const amount = values[kind] ?? 0;
      if (!Number.isSafeInteger(amount) || amount < 0)
        throw new TypeError(`${kind} usage must be a non-negative safe integer.`);
      const limit =
        this.limits[`max${kind[0]!.toUpperCase()}${kind.slice(1)}` as keyof AnalysisBudgets];
      if (this.usage[kind] + amount > limit) exceeded.push([kind, limit]);
    }
    for (const [kind, limit] of exceeded) {
      this.exceeded.set(kind, limit);
    }
    if (exceeded.length > 0) {
      return false;
    }
    for (const kind of usageKinds) this.usage[kind] += values[kind] ?? 0;
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

/**
 * Count JSON nodes and UTF-8 serialized bytes without constructing a normalized
 * document. The walk continues until every configured ceiling has either been
 * exceeded or the value has been fully measured, so a rejected reservation can
 * report all exceeded limits deterministically.
 */
export function measureEvidenceUsage(
  value: unknown,
  ceilings: Partial<EvidenceBudgetMeasurement> = {},
): EvidenceBudgetMeasurement {
  const maxNodes = ceilings.evidenceNodes ?? Number.MAX_SAFE_INTEGER;
  const maxBytes = ceilings.serializedBytes ?? Number.MAX_SAFE_INTEGER;
  const pending: Array<
    | { type: "value"; value: unknown }
    | { type: "leave"; value: object }
  > = [{ type: "value", value }];
  const active = new WeakSet<object>();
  let evidenceNodes = 0;
  let serializedBytes = 0;
  while (pending.length > 0) {
    const item = pending.pop()!;
    if (item.type === "leave") {
      active.delete(item.value);
      continue;
    }
    const current = item.value;
    evidenceNodes += 1;
    if (current === null || typeof current === "boolean") {
      serializedBytes += Buffer.byteLength(JSON.stringify(current));
    } else if (typeof current === "number" || typeof current === "string") {
      if (typeof current === "number" && !Number.isFinite(current))
        throw new TypeError("Evidence value is not JSON serializable.");
      const serialized = JSON.stringify(current);
      if (serialized === undefined) throw new TypeError("Evidence value is not JSON serializable.");
      serializedBytes += Buffer.byteLength(serialized);
    } else if (Array.isArray(current)) {
      if (active.has(current)) throw new TypeError("Evidence value contains a cycle.");
      active.add(current);
      serializedBytes += 2 + Math.max(0, current.length - 1);
      pending.push({ type: "leave", value: current });
      for (let index = current.length - 1; index >= 0; index -= 1)
        pending.push({ type: "value", value: current[index] });
    } else if (typeof current === "object") {
      if (
        !([Object.prototype, null] as (object | null)[]).includes(Object.getPrototypeOf(current))
      )
        throw new TypeError("Evidence value is not JSON serializable.");
      const object = current as Record<string, unknown>;
      if (active.has(object)) throw new TypeError("Evidence value contains a cycle.");
      active.add(object);
      const entries = Object.entries(object);
      serializedBytes += 2 + Math.max(0, entries.length - 1);
      pending.push({ type: "leave", value: object });
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const [key, child] = entries[index]!;
        const serializedKey = JSON.stringify(key);
        if (serializedKey === undefined)
          throw new TypeError("Evidence key is not JSON serializable.");
        serializedBytes += Buffer.byteLength(serializedKey) + 1;
        pending.push({ type: "value", value: child });
      }
    } else {
      throw new TypeError("Evidence value is not JSON serializable.");
    }
    if (evidenceNodes > maxNodes && serializedBytes > maxBytes)
      return { evidenceNodes, serializedBytes };
  }
  return { evidenceNodes, serializedBytes };
}
