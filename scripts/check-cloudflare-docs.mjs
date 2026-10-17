import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../apps/docs/doc_build");
const files = [];
async function walk(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(file);
    else if (entry.isFile()) files.push({ file, size: (await fs.stat(file)).size });
    else throw new Error(`Unsupported output entry: ${file}`);
  }
}
await walk(root);
if (files.length > 20_000) throw new Error(`Pages Free file limit exceeded: ${files.length}`);
for (const { file, size } of files) {
  if (size > 25 * 1024 * 1024) throw new Error(`Pages asset exceeds 25 MiB: ${file}`);
}
for (const required of [
  "index.html",
  "404.html",
  "setup.html",
  "de/setup.html",
  "1.0.0/setup.html",
  "rules/config/name-required.html",
  "llms.txt",
  "llms-full.txt",
  "_headers",
]) {
  await fs.access(path.join(root, required));
}
const html = await fs.readFile(path.join(root, "index.html"), "utf8");
if (!html.includes('href="https://mfdoctor.kevinbeier.com/index.md"')) {
  throw new Error("Missing canonical documentation origin in production homepage links");
}
if (/(?:src|href)="\/module-federation-doctor\//.test(html)) {
  throw new Error("GitHub Pages base path leaked into production build");
}
if (process.env.CF_PAGES === "1") {
  const token = process.env.CF_WEB_ANALYTICS_TOKEN;
  if (!/^[a-f0-9]{32}$/.test(token ?? "")) {
    throw new Error("Missing or invalid CF_WEB_ANALYTICS_TOKEN");
  }
  // Rspress' standalone 404 page does not include the configured document head.
  for (const { file } of files.filter(
    (entry) => entry.file.endsWith(".html") && path.basename(entry.file) !== "404.html",
  )) {
    const content = await fs.readFile(file, "utf8");
    const beacons =
      content.match(/<script\b[^>]*static\.cloudflareinsights\.com\/beacon\.min\.js[^>]*>/g) ?? [];
    if (beacons.length !== 1 || !beacons[0].includes(token)) {
      throw new Error(`Expected exactly one configured Cloudflare Analytics beacon: ${file}`);
    }
  }
}
// Only content-hashed files may receive the immutable /static/* cache rule.
for (const { file } of files) {
  const relative = path.relative(root, file).split(path.sep).join("/");
  if (relative.startsWith("static/") && !/[.-][a-f0-9]{8,}\./i.test(relative)) {
    throw new Error(`Unhashed asset would receive immutable caching: ${relative}`);
  }
}
console.log(
  `Cloudflare output checked: ${files.length} files, ${files.reduce((sum, file) => sum + file.size, 0)} bytes`,
);
