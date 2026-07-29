import fs from "node:fs/promises";
import path from "node:path";

const outputDir = process.argv[2];
if (!outputDir)
  throw new Error("Usage: node scripts/capture-runtime-devtools-partial.mjs <raw-dir>");

await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(
  path.join(outputDir, "upstream-devtools-partial.json"),
  `${JSON.stringify(
    {
      reports: [
        {
          traceId: "trace-unknown-version",
          status: "pending",
          startedAt: 1,
          updatedAt: 2,
          duration: 1,
          events: [],
          __scope: "runtime_host",
        },
      ],
    },
    null,
    2,
  )}\n`,
);
