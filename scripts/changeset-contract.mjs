import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const directory = path.join(root, ".changeset");
const files = fs
  .readdirSync(directory)
  .filter((file) => file.endsWith(".md") && file !== "README.md")
  .sort();

const errors = [];
for (const file of files) {
  // Git preserves the repository's CRLF files on Windows; validate the
  // changeset grammar independently of the checkout line ending.
  const source = fs.readFileSync(path.join(directory, file), "utf8").replaceAll("\r\n", "\n");
  if (!source.startsWith("---\n")) {
    errors.push(`${file}: frontmatter must start with ---`);
    continue;
  }
  const closing = source.indexOf("\n---\n", 4);
  if (closing < 0) errors.push(`${file}: frontmatter must close with ---`);
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Checked ${files.length} changeset frontmatter files.`);
}
