import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = [
  "examples/compatibility/webpack",
  "examples/compatibility/vite-multi-instance",
  "examples/compatibility/rspack-adapter",
  "examples/compatibility/rsbuild-adapter",
  "examples/compatibility/modern",
];

await Promise.all(
  fixtures.map((fixture) =>
    fs.rm(path.join(root, fixture, ".mf", "doctor"), { recursive: true, force: true }),
  ),
);
