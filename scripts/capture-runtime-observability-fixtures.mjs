import fs from "node:fs/promises";
import path from "node:path";

const [inputDir, outputDir] = process.argv.slice(2);
if (!inputDir || !outputDir) {
  throw new Error(
    "Usage: node scripts/capture-runtime-observability-fixtures.mjs <raw-dir> <output-dir>",
  );
}

const reports = [
  ["upstream-component-success.json", "current-2.5.3.json", "runtime-loaded-success"],
  ["upstream-snapshot-failure.json", "snapshot-failure-2.5.3.json", "snapshot-failure"],
  ["upstream-devtools-partial.json", "partial-devtools.json", "trace-unknown-version"],
];

function sanitizeReport(value, label) {
  const source = JSON.parse(JSON.stringify(value));
  if (Array.isArray(source.reports)) {
    return { ...source, reports: source.reports.map((report) => sanitizeReport(report, label)) };
  }
  const originalStartedAt = source.startedAt;
  const safeStartedAt = 1_700_000_000_000;

  function visit(item) {
    if (Array.isArray(item)) return item.map((child) => visit(child));
    if (!item || typeof item !== "object") {
      if (typeof item !== "string") return item;
      return item
        .replace(
          /\b(?:token|authorization|cookie|secret|password|session|api[_-]?key)\s*[:=]\s*[^&\s'",;<>]+/gi,
          "[REDACTED]",
        )
        .replace(/Bearer\s+[^\s]+/gi, "Bearer [REDACTED]")
        .replaceAll("?[REDACTED]", "")
        .replaceAll(
          "http://localhost:3001/mf-manifest.json",
          "https://cdn.example.com/remote/mf-manifest.json",
        )
        .replaceAll("http://localhost:3001", "https://cdn.example.com/remote")
        .replaceAll("?token=secret#hash", "")
        .replaceAll(
          "https://cdn.example.com/remote/?v=20260508#hash",
          "https://cdn.example.com/remote/",
        )
        .replaceAll(
          "https://cdn.example.com/remote/remoteEntry.js?v=20260508#hash",
          "https://cdn.example.com/remote/remoteEntry.js",
        )
        .replaceAll(
          "remote:http://localhost:3001/mf-manifest.json?token=secret#hash",
          "remote:https://cdn.example.com/remote/mf-manifest.json",
        )
        .replaceAll(
          "/private/tmp/mf-core-RJoZJ2/core/packages/observability-plugin/__tests__/doctor-capture.spec.ts",
          "[UPSTREAM_TEST]",
        )
        .replace(/\/(?:private\/)?tmp\/[^\s)]+/g, "[UPSTREAM_RUNTIME]")
        .replace(/\/Users\/[^\s)]+/g, "[UPSTREAM_PATH]")
        .replaceAll("file:///private/tmp/mf-core-RJoZJ2/core/", "[UPSTREAM_RUNTIME]");
    }

    const result = {};
    for (const [childKey, child] of Object.entries(item)) {
      if (["traceId"].includes(childKey)) result[childKey] = `mf-capture-${label}`;
      else if (
        ["startedAt", "updatedAt", "timestamp"].includes(childKey) &&
        typeof child === "number"
      ) {
        result[childKey] = safeStartedAt + (child - originalStartedAt);
      } else if (childKey === "errorStack") {
        result[childKey] = visit(child);
      } else result[childKey] = visit(child);
    }
    return result;
  }

  return visit(source);
}

await fs.mkdir(outputDir, { recursive: true });
for (const [inputName, outputName, label] of reports) {
  const raw = JSON.parse(await fs.readFile(path.join(inputDir, inputName), "utf8"));
  const sanitized = sanitizeReport(raw, label);
  const serialized = JSON.stringify(sanitized, null, 2).replace(
    /\[\n\s+("[^"\n]+")\n\s+\]/g,
    "[$1]",
  );
  await fs.writeFile(path.join(outputDir, outputName), `${serialized}\n`);
}
