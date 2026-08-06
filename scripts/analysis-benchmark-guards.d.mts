export function assertLiteralFixturePath(value: unknown, label: string): string;
export function sourceFilesFromFixtureFiles(files: unknown, label?: string): readonly string[];
export function highWaterRssBytes(
  memoryUsage?: { rss?: number },
  resourceUsage?: { maxRSS?: number },
): number;
