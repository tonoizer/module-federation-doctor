import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-pack-"));

function run(command, args, cwd = temporary) {
  execFileSync(command, args, { cwd, stdio: "inherit", env: { ...process.env, CI: "" } });
}

try {
  run("pnpm", ["pack", "--pack-destination", temporary], root);
  const archive = (await fs.readdir(temporary)).find((file) => file.endsWith(".tgz"));
  assert(archive, "pnpm pack did not create a tarball");
  const tarball = path.join(temporary, archive);
  const consumer = path.join(temporary, "consumer");
  await fs.mkdir(path.join(consumer, "src"), { recursive: true });
  await fs.writeFile(
    path.join(consumer, "package.json"),
    JSON.stringify({
      name: "mfdoctor-tarball-consumer",
      private: true,
      type: "module",
      scripts: {
        check: "node check.mjs",
        cli: "mfdoctor --help",
        vite: "vite build",
        rspack: "rspack build",
        rsbuild: "rsbuild build",
        webpack: "webpack --mode production",
      },
      dependencies: {
        "@module-federation/doctor": `file:${tarball}`,
        "@rspack/cli": "2.1.5",
        "@rspack/core": "2.1.5",
        "@rsbuild/core": "2.1.5",
        vite: "8.1.0",
        webpack: "5.105.4",
        "webpack-cli": "6.0.1",
      },
    }),
  );
  await fs.writeFile(
    path.join(consumer, "index.html"),
    '<script type="module" src="/src/index.js"></script>',
  );
  await fs.writeFile(path.join(consumer, "src/index.js"), "export const smoke = true;\n");
  await fs.writeFile(
    path.join(consumer, "check.mjs"),
    `import assert from "node:assert/strict";
const api = await import("@module-federation/doctor");
const vite = await import("@module-federation/doctor/vite");
const rspack = await import("@module-federation/doctor/rspack");
const rsbuild = await import("@module-federation/doctor/rsbuild");
const webpack = await import("@module-federation/doctor/webpack");
const rules = await import("@module-federation/doctor/rules");
const reportSchema = await import("@module-federation/doctor/schemas/report.schema.json", { with: { type: "json" } });
const packageJson = await import("@module-federation/doctor/package.json", { with: { type: "json" } });
assert.equal(typeof api.analyze, "function");
assert.equal(typeof api.probeManifest, "function");
assert.equal(typeof vite.federationDoctor, "function");
assert.equal(typeof rspack.moduleFederationDoctorPlugin, "function");
assert.equal(typeof rsbuild.pluginModuleFederationDoctor, "function");
assert.equal(typeof webpack.moduleFederationDoctorPlugin, "function");
assert.equal(typeof vite.default, "function");
assert.equal(typeof rspack.default, "function");
assert.equal(typeof rsbuild.default, "function");
assert.equal(typeof webpack.default, "function");
assert.equal(typeof rules.defineRule, "function");
assert.equal(reportSchema.default.title, "Module Federation Doctor report");
assert.equal(packageJson.default.bin.mfdoctor, "dist/cli.js");
`,
  );
  const doctorOptions =
    '{ moduleFederation: { name: "consumer" }, output: { formats: [] }, rules: { "doctor/partial-analysis": "off", "config/plugin-package-mismatch": "off", "artifact/remote-entry-missing": "off" } }';
  await fs.writeFile(
    path.join(consumer, "vite.config.js"),
    `import { federationDoctor } from "@module-federation/doctor/vite";
export default { plugins: [federationDoctor(${doctorOptions})] };
`,
  );
  await fs.writeFile(
    path.join(consumer, "rspack.config.mjs"),
    `import { moduleFederationDoctorPlugin } from "@module-federation/doctor/rspack";
export default { mode: "production", entry: "./src/index.js", plugins: [moduleFederationDoctorPlugin(${doctorOptions})] };
`,
  );
  await fs.writeFile(
    path.join(consumer, "rsbuild.config.mjs"),
    `import { defineConfig } from "@rsbuild/core";
import { pluginModuleFederationDoctor } from "@module-federation/doctor/rsbuild";
export default defineConfig({ plugins: [pluginModuleFederationDoctor(${doctorOptions})] });
`,
  );
  await fs.writeFile(
    path.join(consumer, "webpack.config.mjs"),
    `import { moduleFederationDoctorPlugin } from "@module-federation/doctor/webpack";
export default { mode: "production", entry: "./src/index.js", plugins: [moduleFederationDoctorPlugin(${doctorOptions})] };
`,
  );
  run("pnpm", ["install", "--ignore-scripts"], consumer);
  run("pnpm", ["check"], consumer);
  run("pnpm", ["cli"], consumer);
  run("pnpm", ["vite"], consumer);
  run("pnpm", ["rspack"], consumer);
  run("pnpm", ["rsbuild"], consumer);
  run("pnpm", ["webpack"], consumer);
  process.stdout.write(`Tarball consumer passed: ${pathToFileURL(tarball).href}\n`);
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
