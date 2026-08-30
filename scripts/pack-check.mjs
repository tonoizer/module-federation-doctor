import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const packageJson = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-pack-"));
const packageManager = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const packageManagerArgs = [];
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
// Packing also exercises temporary directories and installed tarball consumers,
// where there is intentionally no Git checkout for Husky to initialize.
const packEnvironment = { ...process.env, CI: "", HUSKY: "0" };

function packedFiles() {
  const output = execFileSync(npmCommand, ["pack", "--dry-run", "--ignore-scripts", "--json"], {
    cwd: root,
    encoding: "utf8",
    env: packEnvironment,
  });
  // npm 10 may still run the package prepare hook despite --ignore-scripts.
  // Keep parsing resilient to lifecycle-hook output before the JSON manifest.
  const manifestStart = output.indexOf("[");
  assert(manifestStart >= 0, "npm pack did not return a JSON manifest");
  const packages = JSON.parse(output.slice(manifestStart));
  return new Set(packages.flatMap((pkg) => pkg.files.map((file) => file.path)));
}

async function assertPortableReadme(files) {
  const readme = await fs.readFile(path.join(root, "README.md"), "utf8");
  const targets = [];
  for (const match of readme.matchAll(/\]\(([^)]+)\)|(?:src|srcset)="([^"]+)"/g)) {
    targets.push(match[1] ?? match[2]);
  }
  const relativeTargets = targets
    .map((target) => target.split("#", 1)[0])
    .filter((target) => target && !/^[a-z][a-z\d+.-]*:/i.test(target) && !target.startsWith("/"));
  for (const target of relativeTargets) {
    const packagePath = target.replace(/^\.\//, "");
    assert(
      files.has(packagePath),
      `README references a file missing from the npm package: ${target}`,
    );
  }
}

function run(command, args, cwd = temporary) {
  execFileSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32" && command.endsWith(".cmd"),
    env: packEnvironment,
  });
}

function capture(command, args, cwd = temporary) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32" && command.endsWith(".cmd"),
    env: packEnvironment,
  });
}

function runForStatus(command, args, cwd = temporary) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32" && command.endsWith(".cmd"),
    env: packEnvironment,
  });
  return {
    status: result.status ?? 2,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function assertAgentPlaybook(files) {
  assert(files.has("AGENTS.md"), "published package must include AGENTS.md");
  assert(
    files.has("skills/mfdoctor/SKILL.md"),
    "published package must include skills/mfdoctor/SKILL.md",
  );
}

async function assertAgentPlaybookContent() {
  const agents = await fs.readFile(path.join(root, "AGENTS.md"), "utf8");
  const skill = await fs.readFile(path.join(root, "skills/mfdoctor/SKILL.md"), "utf8");
  for (const [label, source] of [
    ["AGENTS.md", agents],
    ["skills/mfdoctor/SKILL.md", skill],
  ]) {
    assert.match(source, /capabilities/i, `${label} must document capabilities`);
    assert.match(source, /mfdoctor check/i, `${label} must document check`);
    assert.match(source, /mfdoctor prompt/i, `${label} must document prompt`);
    assert.match(
      source,
      /No suppressions unless the user asked/i,
      `${label} must hard-rule suppressions as opt-in`,
    );
    assert.match(
      source,
      /No probe unless the user asked/i,
      `${label} must hard-rule probe as opt-in`,
    );
    assert.match(
      source,
      /Do not claim green from [`']?check[`']? alone/i,
      `${label} must forbid claiming green from check alone`,
    );
  }
}

try {
  const files = packedFiles();
  await assertPortableReadme(files);
  assertAgentPlaybook(files);
  await assertAgentPlaybookContent();
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
        "@tonoizer/mfdoctor": `file:${tarball}`,
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
const api = await import("@tonoizer/mfdoctor");
const vite = await import("@tonoizer/mfdoctor/vite");
const nuxt = await import("@tonoizer/mfdoctor/nuxt");
const rspack = await import("@tonoizer/mfdoctor/rspack");
const rsbuild = await import("@tonoizer/mfdoctor/rsbuild");
const webpack = await import("@tonoizer/mfdoctor/webpack");
const modern = await import("@tonoizer/mfdoctor/modern");
const rules = await import("@tonoizer/mfdoctor/rules");
const capture = await import("@tonoizer/mfdoctor/capture");
const packageJson = await import("@tonoizer/mfdoctor/package.json", { with: { type: "json" } });
assert.equal(typeof api.analyze, "function");
assert.equal(typeof api.probeManifest, "function");
assert.equal(typeof api.buildUiPayload, "function");
assert.equal(typeof api.buildSemanticGraph, "function");
assert.equal(typeof api.buildSemanticUiPayload, "function");
assert.equal(typeof api.querySemanticGraph, "function");
for (const captureOnlyExport of [
  "captureRuntimeBrowserExport",
  "importRuntimeCaptureExport",
  "loadRuntimeCaptureExportFile",
  "writeRuntimeCaptureExportFile",
])
  assert.equal(
    api[captureOnlyExport],
    undefined,
    "default package entry must not expose capture-only export " + captureOnlyExport,
  );
assert.equal(typeof vite.federationDoctor, "function");
assert.equal(typeof nuxt.moduleFederationDoctor.setup, "function");
assert.equal(nuxt.nuxtDoctor, nuxt.moduleFederationDoctor);
assert.equal(nuxt.federationDoctorNuxt, nuxt.moduleFederationDoctor);
assert.equal(nuxt.default, nuxt.moduleFederationDoctor);
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
const policy = await import("@tonoizer/mfdoctor/policy");
assert.equal(typeof policy.definePolicyPack, "function");
assert.equal(typeof policy.presets.recommended, "object");
assert.equal(typeof policy.presets.strict, "object");
const schemaTitles = {
  baseline: "MFDoctor fingerprint baseline",
  "build-artifact-deployment": "MFDoctor build artifact deployment correlation",
  capabilities: "MFDoctor CLI capabilities",
  config: "MFDoctor canonical config v1",
  evidence: "MFDoctor evidence protocol v2",
  "finding-lineage": "MFDoctor finding lineage and history",
  "governance-waiver": "MFDoctor governance waiver and audit decision",
  identity: "MFDoctor semantic identity",
  "identity-correlation": "MFDoctor semantic identity correlation",
  "identity-governance": "MFDoctor identity governance",
  "semantic-graph": "MFDoctor additive semantic graph",
  probe: "MFDoctor manifest probe result",
  project: "MFDoctor project facts",
  report: "MFDoctor report",
  "runtime-capture": "MFDoctor external runtime capture v1",
  "runtime-identity-correlation": "MFDoctor runtime identity correlation",
  "runtime-trace": "MFDoctor runtime trace correlation summary",
  ui: "MFDoctor federation graph payload",
};
const schemaImports = {
  baseline: await import("@tonoizer/mfdoctor/schemas/baseline.schema.json", { with: { type: "json" } }),
  "build-artifact-deployment": await import("@tonoizer/mfdoctor/schemas/build-artifact-deployment.schema.json", { with: { type: "json" } }),
  capabilities: await import("@tonoizer/mfdoctor/schemas/capabilities.schema.json", { with: { type: "json" } }),
  config: await import("@tonoizer/mfdoctor/schemas/config.schema.json", { with: { type: "json" } }),
  evidence: await import("@tonoizer/mfdoctor/schemas/evidence.schema.json", { with: { type: "json" } }),
  "finding-lineage": await import("@tonoizer/mfdoctor/schemas/finding-lineage.schema.json", { with: { type: "json" } }),
  "governance-waiver": await import("@tonoizer/mfdoctor/schemas/governance-waiver.schema.json", { with: { type: "json" } }),
  identity: await import("@tonoizer/mfdoctor/schemas/identity.schema.json", { with: { type: "json" } }),
  "identity-correlation": await import("@tonoizer/mfdoctor/schemas/identity-correlation.schema.json", { with: { type: "json" } }),
  "identity-governance": await import("@tonoizer/mfdoctor/schemas/identity-governance.schema.json", { with: { type: "json" } }),
  "semantic-graph": await import("@tonoizer/mfdoctor/schemas/semantic-graph.schema.json", { with: { type: "json" } }),
  probe: await import("@tonoizer/mfdoctor/schemas/probe.schema.json", { with: { type: "json" } }),
  project: await import("@tonoizer/mfdoctor/schemas/project.schema.json", { with: { type: "json" } }),
  report: await import("@tonoizer/mfdoctor/schemas/report.schema.json", { with: { type: "json" } }),
  "runtime-capture": await import("@tonoizer/mfdoctor/schemas/runtime-capture.schema.json", { with: { type: "json" } }),
  "runtime-identity-correlation": await import("@tonoizer/mfdoctor/schemas/runtime-identity-correlation.schema.json", { with: { type: "json" } }),
  "runtime-trace": await import("@tonoizer/mfdoctor/schemas/runtime-trace.schema.json", { with: { type: "json" } }),
  ui: await import("@tonoizer/mfdoctor/schemas/ui.schema.json", { with: { type: "json" } }),
};
for (const [name, title] of Object.entries(schemaTitles)) {
  const schema = schemaImports[name];
  assert.equal(schema.default.title, title);
  assert.equal(schema.default.type, "object");
  assert.equal(typeof schema.default.$id, "string");
}
assert.equal(packageJson.default.bin.mfdoctor, "dist/cli.js");
const { createRequire } = await import("node:module");
const { readFileSync } = await import("node:fs");
const { dirname, join } = await import("node:path");
const require = createRequire(import.meta.url);
const packageRoot = dirname(require.resolve("@tonoizer/mfdoctor/package.json"));
const agents = readFileSync(join(packageRoot, "AGENTS.md"), "utf8");
const skill = readFileSync(join(packageRoot, "skills/mfdoctor/SKILL.md"), "utf8");
assert.match(agents, /No suppressions unless the user asked/);
assert.match(skill, /No probe unless the user asked/);
`,
  );
  const doctorOptions =
    '{ moduleFederation: { name: "consumer" }, output: { formats: [] }, rules: { "doctor/partial-analysis": "off", "config/plugin-package-mismatch": "off", "artifact/remote-entry-missing": "off" } }';
  await fs.writeFile(
    path.join(consumer, "vite.config.js"),
    `import { federationDoctor } from "@tonoizer/mfdoctor/vite";
export default { plugins: [federationDoctor(${doctorOptions})] };
`,
  );
  await fs.writeFile(
    path.join(consumer, "rspack.config.mjs"),
    `import { moduleFederationDoctorPlugin } from "@tonoizer/mfdoctor/rspack";
export default { mode: "production", entry: "./src/index.js", plugins: [moduleFederationDoctorPlugin(${doctorOptions})] };
`,
  );
  await fs.writeFile(
    path.join(consumer, "rsbuild.config.mjs"),
    `import { defineConfig } from "@rsbuild/core";
import { pluginModuleFederationDoctor } from "@tonoizer/mfdoctor/rsbuild";
export default defineConfig({ plugins: [pluginModuleFederationDoctor(${doctorOptions})] });
`,
  );
  await fs.writeFile(
    path.join(consumer, "webpack.config.mjs"),
    `import { ModuleFederationDoctorPlugin } from "@tonoizer/mfdoctor/webpack";
export default { mode: "production", entry: "./src/index.js", plugins: [ModuleFederationDoctorPlugin(${doctorOptions})] };
`,
  );
  await fs.writeFile(
    path.join(consumer, "modern-smoke.mjs"),
    `import assert from "node:assert/strict";
import { moduleFederationDoctorPlugin, appendModuleFederationDoctor } from "@tonoizer/mfdoctor/modern";
const plugin = moduleFederationDoctorPlugin(${doctorOptions});
assert.equal(plugin.name, "@tonoizer/mfdoctor");
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
  // Keep pnpm's project lookup anchored at the MFDoctor workspace. A temp
  // consumer can otherwise inherit an unrelated parent packageManager field
  // (for example yarn in a user's home package.json).
  run(packageManager, [...consumerPnpmArgs, "install", "--ignore-scripts"], root);
  run(packageManager, [...consumerPnpmArgs, "check"], root);
  run(packageManager, [...consumerPnpmArgs, "cli"], root);
  run(npxCommand, ["--no-install", "mfdoctor", "--help"], consumer);
  const capabilities = JSON.parse(
    capture(npxCommand, ["--no-install", "mfdoctor", "capabilities"], consumer),
  );
  assert.equal(capabilities.package.name, "@tonoizer/mfdoctor");
  assert.equal(capabilities.package.version, packageJson.version);
  assert.equal(capabilities.schemaVersion, 1);
  assert.equal(capabilities.schemas.capabilities, "./schemas/capabilities.schema.json");
  assert.deepEqual(capabilities.formats, ["terminal", "json", "sarif"]);
  assert.ok(Array.isArray(capabilities.nonGoals) && capabilities.nonGoals.length > 0);
  assert.equal(typeof capabilities.completeness?.check, "string");
  assert.equal(capabilities.githubAction?.name, "workspace-federation-gate");
  assert.equal(capabilities.networkPolicy?.offlineByDefault, true);
  assert.deepEqual(capabilities.networkPolicy?.networkCommands, ["compare", "probe"]);
  assert.equal(capabilities.bundlerMatrix?.source, "./fixtures/compatibility-matrix.json");
  assert.ok(capabilities.bundlerMatrix?.supported.includes("vite"));
  assert.ok(capabilities.bundlerMatrix?.partial.includes("modern"));

  const repairLoop = path.join(consumer, "repair-loop");
  await fs.mkdir(repairLoop, { recursive: true });
  await fs.writeFile(
    path.join(repairLoop, "package.json"),
    JSON.stringify({ name: "mfdoctor-repair-loop", private: true, type: "module" }),
  );
  const repairConfig = (name) => `export default {
  moduleFederation: { ${name ? `name: ${JSON.stringify(name)}, ` : ""}exposes: {}, remotes: {}, shared: {} },
  failOn: "error",
  rules: {
    "doctor/partial-analysis": "off",
    "config/name-required": "error",
    "config/plugin-package-mismatch": "off",
    "artifact/remote-entry-missing": "off",
  },
};
`;
  await fs.writeFile(path.join(repairLoop, "mfdoctor.config.mjs"), repairConfig(""));
  const repairCommand = [
    "--no-install",
    "mfdoctor",
    "check",
    "--ci",
    "--format",
    "terminal,json,sarif",
    "--diagnostics-dir",
    ".mf/doctor/diagnostics",
  ];
  const failingRepair = runForStatus(npxCommand, repairCommand, repairLoop);
  assert.equal(
    failingRepair.status,
    1,
    `repair-loop fixture should fail before the fix:\n${failingRepair.stdout}\n${failingRepair.stderr}`,
  );
  assert.match(`${failingRepair.stdout}\n${failingRepair.stderr}`, /config\/name-required/);
  assert.ok(
    (await fs.readdir(path.join(repairLoop, ".mf/doctor/diagnostics/prompts"))).some((file) =>
      file.endsWith(".md"),
    ),
    "failing repair-loop check should write an agent prompt",
  );
  await fs.access(path.join(repairLoop, ".mf/doctor/results.sarif"));

  await fs.writeFile(path.join(repairLoop, "mfdoctor.config.mjs"), repairConfig("repair-loop"));
  const passingRepair = runForStatus(npxCommand, repairCommand, repairLoop);
  assert.equal(
    passingRepair.status,
    0,
    `repair-loop fixture should pass after the narrow fix:\n${passingRepair.stdout}\n${passingRepair.stderr}`,
  );
  const repairReport = JSON.parse(
    await fs.readFile(path.join(repairLoop, ".mf/doctor/report.json"), "utf8"),
  );
  assert.deepEqual(repairReport.findings, []);
  assert.match(
    await fs.readFile(path.join(repairLoop, ".mf/doctor/diagnostics/summary.md"), "utf8"),
    /\(none\)/,
  );
  assert.deepEqual(
    (await fs.readdir(path.join(repairLoop, ".mf/doctor/diagnostics/prompts"))).filter((file) =>
      file.endsWith(".md"),
    ),
    [],
    "passing repair-loop check should remove stale agent prompts",
  );
  run(packageManager, [...consumerPnpmArgs, "vite"], root);
  run(packageManager, [...consumerPnpmArgs, "rspack"], root);
  run(packageManager, [...consumerPnpmArgs, "rsbuild"], root);
  run(packageManager, [...consumerPnpmArgs, "webpack"], root);
  run(packageManager, [...consumerPnpmArgs, "modern"], root);
  process.stdout.write(`Tarball consumer passed: ${pathToFileURL(tarball).href}\n`);
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
