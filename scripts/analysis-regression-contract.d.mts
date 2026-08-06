export const REQUIRED_ANALYSIS_FIXTURES: readonly string[];
export const REQUIRED_MODES: readonly string[];
export const REQUIRED_WORKSPACE_FIXTURES: readonly string[];
export function normalizeReport(report: unknown, root: string): Record<string, unknown>;
export function normalizeAnalysisRun(
  run: unknown,
  evidenceReader: unknown,
  root: string,
): Record<string, unknown>;
export function normalizeAnalysisRow(row: unknown, root: string): Record<string, unknown>;
export function normalizeWorkspaceResult(
  fixture: string,
  result: unknown,
  root: string,
): Record<string, unknown>;
export function assertRegressionContract(
  contract: unknown,
  label?: string,
): Record<string, unknown>;
export function compareRegressionContract(expected: unknown, actual: unknown): string[];
