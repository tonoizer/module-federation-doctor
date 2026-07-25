import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";

const repository = path.resolve(import.meta.dirname, "..");
const docsRoot = path.join(repository, "apps/docs/docs");
const files = await fg("**/*.md", { cwd: docsRoot, absolute: true });
let failed = false;
for (const file of files.sort()) {
  const markdown = await fs.readFile(file, "utf8");
  for (const match of markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1];
    if (!target || /^(?:https?:|#|mailto:)/.test(target)) continue;
    const withoutHash = target.split("#")[0];
    if (!withoutHash) continue;
    const resolved = path.resolve(path.dirname(file), withoutHash);
    if (!resolved.startsWith(docsRoot + path.sep)) {
      process.stderr.write(
        `Doc link leaves Rspress root: ${path.relative(repository, file)} -> ${target}\n`,
      );
      failed = true;
      continue;
    }
    const candidates = path.extname(resolved)
      ? [resolved]
      : [resolved, `${resolved}.md`, path.join(resolved, "index.md")];
    if (
      !(
        await Promise.all(
          candidates.map((candidate) =>
            fs
              .access(candidate)
              .then(() => true)
              .catch(() => false),
          ),
        )
      ).some(Boolean)
    ) {
      process.stderr.write(`Missing doc link: ${path.relative(repository, file)} -> ${target}\n`);
      failed = true;
    }
  }
}
if (failed) process.exitCode = 1;
