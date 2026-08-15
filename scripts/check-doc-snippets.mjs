import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import fg from "fast-glob";

const repository = path.resolve(import.meta.dirname, "..");
const generatedRoot = path.join(repository, "apps/docs/.generated");
const docsRoot = process.env.DOCS_ROOT
  ? path.resolve(repository, process.env.DOCS_ROOT)
  : (await fs.stat(generatedRoot).catch(() => null))?.isDirectory()
    ? generatedRoot
    : path.join(repository, "apps/docs/docs");
const files = await fg("**/*.md", { cwd: docsRoot, absolute: true });
let failed = false;
for (const file of files.sort()) {
  const markdown = await fs.readFile(file, "utf8");
  for (const match of markdown.matchAll(/```(?:ts|typescript)\n([\s\S]*?)```/g)) {
    const result = ts.transpileModule(match[1], {
      fileName: `${file}.ts`,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        strict: true,
      },
      reportDiagnostics: true,
    });
    for (const diagnostic of result.diagnostics ?? []) {
      failed = true;
      process.stderr.write(
        `${path.relative(repository, file)}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}\n`,
      );
    }
  }
}
if (failed) process.exitCode = 1;
