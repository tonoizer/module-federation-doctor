import {
  measureEvidenceUsage,
  type AnalysisBudgetReport,
  type EvidenceBudgetMeasurement,
  type AnalysisBudgetTracker,
} from "./analysis-budgets.js";

type EvidenceBudgetDimension = keyof EvidenceBudgetMeasurement;

interface ReservationMarkers {
  evidenceNodes: WeakSet<AnalysisBudgetTracker>;
  serializedBytes: WeakSet<AnalysisBudgetTracker>;
}

const reservedEvidence = new WeakMap<object, ReservationMarkers>();

function isObject(value: unknown): value is object {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

/** Internal marker used when a reader has already reserved one source dimension. */
export function markEvidenceBudgetDimension(
  value: unknown,
  tracker: AnalysisBudgetTracker,
  dimension: EvidenceBudgetDimension,
): void {
  if (!isObject(value)) return;
  let markers = reservedEvidence.get(value);
  if (!markers) {
    markers = {
      evidenceNodes: new WeakSet<AnalysisBudgetTracker>(),
      serializedBytes: new WeakSet<AnalysisBudgetTracker>(),
    };
    reservedEvidence.set(value, markers);
  }
  markers[dimension].add(tracker);
}

function isDimensionReserved(
  value: unknown,
  tracker: AnalysisBudgetTracker,
  dimension: EvidenceBudgetDimension,
): boolean {
  return isObject(value) && reservedEvidence.get(value)?.[dimension].has(tracker) === true;
}

export class EvidenceBudgetExceededError extends Error {
  readonly report: AnalysisBudgetReport;

  constructor(report: AnalysisBudgetReport) {
    super(
      `Evidence analysis budget exceeded: ${report.exceeded
        .map((item) => `${item.kind} (max ${item.limit})`)
        .join(", ")}.`,
    );
    this.name = "EvidenceBudgetExceededError";
    this.report = report;
  }
}

/** Reserve one evidence document atomically before normalization or hashing. */
export function reserveEvidenceBudget(
  value: unknown,
  tracker: AnalysisBudgetTracker,
): AnalysisBudgetReport {
  const needsNodes = !isDimensionReserved(value, tracker, "evidenceNodes");
  const needsBytes = !isDimensionReserved(value, tracker, "serializedBytes");
  if (!needsNodes && !needsBytes) {
    if (!tracker.checkWallTime()) throw new EvidenceBudgetExceededError(tracker.report());
    return tracker.report();
  }
  const current = tracker.usageSnapshot;
  const measurement = measureEvidenceUsage(value, {
    evidenceNodes: needsNodes
      ? Math.max(0, tracker.limits.maxEvidenceNodes - current.evidenceNodes)
      : Number.MAX_SAFE_INTEGER,
    serializedBytes: needsBytes
      ? Math.max(0, tracker.limits.maxSerializedBytes - current.serializedBytes)
      : Number.MAX_SAFE_INTEGER,
  });
  if (
    !tracker.reserve({
      ...(needsNodes ? { evidenceNodes: measurement.evidenceNodes } : {}),
      ...(needsBytes ? { serializedBytes: measurement.serializedBytes } : {}),
    })
  ) {
    throw new EvidenceBudgetExceededError(tracker.report());
  }
  if (needsNodes) markEvidenceBudgetDimension(value, tracker, "evidenceNodes");
  if (needsBytes) markEvidenceBudgetDimension(value, tracker, "serializedBytes");
  return tracker.report();
}
