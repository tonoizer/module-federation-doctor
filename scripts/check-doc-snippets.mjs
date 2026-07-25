import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import fg from "fast-glob";

const repository = path.resolve(import.meta.dirname, "..");
const files = await fg("apps/docs/docs/**/*.md", { cwd: repository, absolute: true });
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
