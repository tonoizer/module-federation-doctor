import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-pack-"));
const packageManager = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const packageManagerArgs = [];
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";

function run(command, args, cwd = temporary) {
  execFileSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32" && command.endsWith(".cmd"),
    env: { ...process.env, CI: "" },
  });
}

try {
  run(packageManager, [...packageManagerArgs, "pack", "--pack-destination", temporary], root);
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
        modern: "node modern-smoke.mjs",
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
const nuxt = await import("@module-federation/doctor/nuxt");
const rspack = await import("@module-federation/doctor/rspack");
const rsbuild = await import("@module-federation/doctor/rsbuild");
const webpack = await import("@module-federation/doctor/webpack");
const modern = await import("@module-federation/doctor/modern");
const rules = await import("@module-federation/doctor/rules");
const capture = await import("@module-federation/doctor/capture");
const packageJson = await import("@module-federation/doctor/package.json", { with: { type: "json" } });
assert.equal(typeof api.analyze, "function");
assert.equal(typeof api.probeManifest, "function");
assert.equal(typeof api.buildUiPayload, "function");
assert.equal(typeof vite.federationDoctor, "function");
assert.equal(typeof nuxt.nuxtDoctor.setup, "function");
assert.equal(nuxt.federationDoctorNuxt, nuxt.nuxtDoctor);
assert.equal(typeof nuxt.default.setup, "function");
assert.equal(typeof rspack.moduleFederationDoctorPlugin, "function");
assert.equal(typeof rsbuild.pluginModuleFederationDoctor, "function");
assert.equal(typeof webpack.ModuleFederationDoctorPlugin, "function");
assert.equal(webpack.moduleFederationDoctorPlugin, webpack.ModuleFederationDoctorPlugin);
assert.equal(typeof modern.moduleFederationDoctorPlugin, "function");
assert.equal(modern.pluginModuleFederationDoctor, undefined);
assert.equal(typeof modern.appendModuleFederationDoctor, "function");
assert.equal(typeof vite.default, "function");
assert.equal(typeof rspack.default, "function");
assert.equal(typeof rsbuild.default, "function");
assert.equal(typeof webpack.default, "function");
assert.equal(typeof modern.default, "function");
assert.equal(typeof rules.defineRule, "function");
assert.equal(typeof capture.validateRuntimeCaptureEnvelope, "function");
const policy = await import("@module-federation/doctor/policy");
assert.equal(typeof policy.definePolicyPack, "function");
assert.equal(typeof policy.presets.recommended, "object");
assert.equal(typeof policy.presets.strict, "object");
const schemaTitles = {
  baseline: "Module Federation Doctor fingerprint baseline",
  config: "Module Federation Doctor canonical config v1",
  evidence: "Module Federation Doctor evidence protocol v2",
  identity: "Module Federation Doctor semantic identity",
  probe: "Module Federation Doctor manifest probe result",
  project: "Module Federation Doctor project facts",
  report: "Module Federation Doctor report",
  "runtime-capture": "Module Federation Doctor external runtime capture v1",
  "runtime-trace": "Module Federation Doctor runtime trace correlation summary",
  ui: "Module Federation Doctor federation graph payload",
};
const schemaImports = {
  baseline: await import("@module-federation/doctor/schemas/baseline.schema.json", { with: { type: "json" } }),
  config: await import("@module-federation/doctor/schemas/config.schema.json", { with: { type: "json" } }),
  evidence: await import("@module-federation/doctor/schemas/evidence.schema.json", { with: { type: "json" } }),
  identity: await import("@module-federation/doctor/schemas/identity.schema.json", { with: { type: "json" } }),
  probe: await import("@module-federation/doctor/schemas/probe.schema.json", { with: { type: "json" } }),
  project: await import("@module-federation/doctor/schemas/project.schema.json", { with: { type: "json" } }),
  report: await import("@module-federation/doctor/schemas/report.schema.json", { with: { type: "json" } }),
  "runtime-capture": await import("@module-federation/doctor/schemas/runtime-capture.schema.json", { with: { type: "json" } }),
  "runtime-trace": await import("@module-federation/doctor/schemas/runtime-trace.schema.json", { with: { type: "json" } }),
  ui: await import("@module-federation/doctor/schemas/ui.schema.json", { with: { type: "json" } }),
};
for (const [name, title] of Object.entries(schemaTitles)) {
  const schema = schemaImports[name];
  assert.equal(schema.default.title, title);
  assert.equal(schema.default.type, "object");
  assert.equal(typeof schema.default.$id, "string");
}
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
    `import { ModuleFederationDoctorPlugin } from "@module-federation/doctor/webpack";
export default { mode: "production", entry: "./src/index.js", plugins: [ModuleFederationDoctorPlugin(${doctorOptions})] };
`,
  );
  await fs.writeFile(
    path.join(consumer, "modern-smoke.mjs"),
    `import assert from "node:assert/strict";
import { moduleFederationDoctorPlugin, appendModuleFederationDoctor } from "@module-federation/doctor/modern";
const plugin = moduleFederationDoctorPlugin(${doctorOptions});
assert.equal(plugin.name, "@module-federation/doctor");
assert.equal(typeof plugin.setup, "function");
const registered = [];
const chain = { plugin(name) { return { use(p) { registered.push([name, p]); return this; } }; } };
await plugin.setup({
  getAppContext: () => ({ bundlerType: "rspack", appDirectory: process.cwd() }),
  modifyBundlerChain(fn) { fn(chain); },
});
assert.equal(registered.length, 1);
assert.equal(registered[0][0], "module-federation-doctor");
assert.equal(typeof registered[0][1].apply, "function");
const rspackChain = [];
appendModuleFederationDoctor(
  { plugin(name) { return { use(p) { rspackChain.push([name, p]); return this; } }; } },
  ${doctorOptions},
);
assert.equal(rspackChain.length, 1);
assert.equal(rspackChain[0][0], "module-federation-doctor");
`,
  );
  const consumerPnpmArgs = [...packageManagerArgs, "--dir", consumer];
  // Keep pnpm's project lookup anchored at the Doctor workspace. A temp
  // consumer can otherwise inherit an unrelated parent packageManager field
  // (for example yarn in a user's home package.json).
  run(packageManager, [...consumerPnpmArgs, "install", "--ignore-scripts"], root);
  run(packageManager, [...consumerPnpmArgs, "check"], root);
  run(packageManager, [...consumerPnpmArgs, "cli"], root);
  run(npxCommand, ["--no-install", "mfdoctor", "--help"], consumer);
  run(packageManager, [...consumerPnpmArgs, "vite"], root);
  run(packageManager, [...consumerPnpmArgs, "rspack"], root);
  run(packageManager, [...consumerPnpmArgs, "rsbuild"], root);
  run(packageManager, [...consumerPnpmArgs, "webpack"], root);
  run(packageManager, [...consumerPnpmArgs, "modern"], root);
  process.stdout.write(`Tarball consumer passed: ${pathToFileURL(tarball).href}\n`);
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
