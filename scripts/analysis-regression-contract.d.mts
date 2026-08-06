export function normalizeReport(report: unknown): Record<string, unknown>;
export function normalizeAnalysisRun(
  run: unknown,
  evidenceReader: unknown,
): Record<string, unknown>;
export function normalizeAnalysisRow(row: unknown): Record<string, unknown>;
export function normalizeWorkspaceResult(fixture: string, result: unknown): Record<string, unknown>;
export function compareRegressionContract(expected: unknown, actual: unknown): string[];
