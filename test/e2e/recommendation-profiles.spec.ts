import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";

const execFileAsync = promisify(execFile);
const repository = path.resolve(import.meta.dirname, "../..");
const vite = path.join(
  repository,
  "examples/mixed-federation/host-vite/node_modules/vite/bin/vite.js",
);
const roots: string[] = [];

type Severity = "info" | "warning" | "error";

type RecommendationScenario = {
  name: string;
  profile: "demo" | "production";
  mode?: "development" | "ci";
  ci?: boolean;
  expectedObservability: "absent" | "warning";
  expectedPrefix: "absent" | "error";
  expectedOfflineRemotes: "absent" | "warning";
  observabilityPackage?: "missing" | "unregistered" | "registered";
  shareSubpaths?: boolean;
};

type Finding = {
  ruleId: string;
  severity: Severity;
  evidence?: Record<string, unknown>;
};

type Report = {
  findings: Finding[];
  summary: { errors: number; warnings: number };
};

const scenarios: RecommendationScenario[] = [
  {
    name: "demo development softens local remote recovery and optional observability",
    profile: "demo",
    mode: "development",
    expectedObservability: "absent",
    expectedPrefix: "error",
    expectedOfflineRemotes: "absent",
  },
  {
    name: "production development keeps all recommendation nudges visible",
    profile: "production",
    mode: "development",
    expectedObservability: "warning",
    expectedPrefix: "error",
    expectedOfflineRemotes: "warning",
  },
  {
    name: "production CI elevates missing observability and keeps React prefix as error",
    profile: "production",
    mode: "ci",
    expectedObservability: "warning",
    expectedPrefix: "error",
    expectedOfflineRemotes: "warning",
  },
  {
    name: "demo without an explicit mode follows CI detection and production overlay",
    profile: "demo",
    ci: true,
    expectedObservability: "warning",
    expectedPrefix: "error",
    expectedOfflineRemotes: "warning",
  },
  {
    name: "declared observability without runtime registration remains actionable",
    profile: "production",
    mode: "ci",
    expectedObservability: "warning",
    expectedPrefix: "error",
    expectedOfflineRemotes: "warning",
    observabilityPackage: "unregistered",
  },
  {
    name: "registered observability suppresses only its own nudge",
    profile: "production",
    mode: "ci",
    expectedObservability: "absent",
    expectedPrefix: "error",
    expectedOfflineRemotes: "warning",
    observabilityPackage: "registered",
  },
  {
    name: "exact subpath shares suppress only their prefix nudges",
    profile: "production",
    mode: "ci",
    expectedObservability: "warning",
    expectedPrefix: "absent",
    expectedOfflineRemotes: "warning",
    shareSubpaths: true,
  },
  {
    name: "registered observability and exact subpath shares produce a quiet recommendation report",
    profile: "production",
    mode: "ci",
    expectedObservability: "absent",
    expectedPrefix: "absent",
    expectedOfflineRemotes: "warning",
    observabilityPackage: "registered",
    shareSubpaths: true,
  },
];

const adapterScenarios: RecommendationScenario[] = [
  {
    name: "Vite adapter keeps demo development quiet for local remotes",
    profile: "demo",
    mode: "development",
    expectedObservability: "absent",
    expectedPrefix: "error",
    expectedOfflineRemotes: "absent",
  },
  {
    name: "Vite adapter emits production CI nudges",
    profile: "production",
    mode: "ci",
    expectedObservability: "warning",
    expectedPrefix: "error",
    expectedOfflineRemotes: "warning",
  },
];

const moduleFederation = {
  name: "recommendation_profile_e2e",
  manifest: true,
  shareStrategy: "version-first",
  remotes: {
    localRemote: {
      type: "global",
      name: "local_remote",
      entry: "http://127.0.0.1:4010/remoteEntry.js",
      entryGlobalName: "local_remote",
      shareScope: "default",
    },
  },
  exposes: { "./App": "./src/App.ts" },
};

const quietRules = {
  "config/plugin-package-mismatch": "off",
  "config/remote-localhost-in-production": "off",
  "config/remote-manifest-recommended": "off",
  "artifact/remote-entry-missing": "off",
  "artifact/types-missing": "off",
  "artifact/types-metadata-missing": "off",
  "doctor/partial-analysis": "off",
  "shared/unused": "off",
};

function sharedConfig(shareSubpaths: boolean): Record<string, Record<string, boolean>> {
  const shared: Record<string, Record<string, boolean>> = {
    react: { singleton: true },
    "react-dom": { singleton: true },
  };
  if (shareSubpaths) {
    shared["react/"] = { singleton: true };
    shared["react-dom/client"] = { singleton: true };
  }
  return shared;
}

function observabilityDependency(scenario: RecommendationScenario): Record<string, string> {
  return scenario.observabilityPackage && scenario.observabilityPackage !== "missing"
    ? { "@module-federation/observability-plugin": "2.8.2" }
    : {};
}

function doctorConfig(scenario: RecommendationScenario, root?: string): Record<string, unknown> {
  const config: Record<string, unknown> = {
    profile: scenario.profile,
    failOn: "never",
    output: {
      formats: ["json"],
      ...(root ? { directory: path.join(root, ".mf/doctor") } : {}),
    },
    moduleFederation: {
      ...moduleFederation,
      shared: sharedConfig(scenario.shareSubpaths === true),
      ...(scenario.observabilityPackage === "registered"
        ? { runtimePlugins: ["@module-federation/observability-plugin/node"] }
        : {}),
    },
    rules: quietRules,
  };
  if (scenario.mode !== undefined) config.mode = scenario.mode;
  if (root !== undefined) config.root = root;
  return config;
}

async function createProject(scenario: RecommendationScenario): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-recommendation-e2e-"));
  roots.push(root);
  await fs.mkdir(path.join(root, "src"));
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "recommendation-profile-e2e",
      dependencies: {
        react: "19.2.8",
        "react-dom": "19.2.8",
        "@module-federation/enhanced": "2.8.2",
        ...observabilityDependency(scenario),
      },
    }),
  );
  await fs.writeFile(
    path.join(root, "src/App.ts"),
    'import "react/jsx-runtime";\nimport "react-dom/client";\nexport {};\n',
  );

  await fs.writeFile(
    path.join(root, "mfdoctor.config.ts"),
    `export default ${JSON.stringify({
      ...doctorConfig(scenario),
    })};\n`,
  );
  return root;
}

async function runCliCheck(root: string, scenario: RecommendationScenario): Promise<Report> {
  try {
    await execFileAsync(process.execPath, [cli(), "check", root, "--format", "json"], {
      cwd: repository,
      env: {
        ...process.env,
        CI: scenario.ci === true || scenario.mode === "ci" ? "true" : "false",
        NODE_ENV: scenario.ci === true || scenario.mode === "ci" ? "production" : "development",
      },
      maxBuffer: 2 * 1024 * 1024,
    });
  } catch (error) {
    const result = error as { message?: string; stdout?: string; stderr?: string };
    throw new Error(
      [
        `Recommendation check failed for ${scenario.name}.`,
        result.message ?? "unknown process error",
        result.stdout ?? "",
        result.stderr ?? "",
      ].join("\n"),
      { cause: error },
    );
  }

  return JSON.parse(await fs.readFile(path.join(root, ".mf/doctor/report.json"), "utf8")) as Report;
}

function cli(): string {
  return path.join(repository, "dist/cli.js");
}

async function createViteAdapterProject(scenario: RecommendationScenario): Promise<string> {
  const root = await fs.mkdtemp(
    path.join(repository, "examples/mixed-federation/host-vite/.mfdoctor-adapter-e2e-"),
  );
  roots.push(root);
  await fs.mkdir(path.join(root, "src"));
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "recommendation-adapter-e2e",
      private: true,
      type: "module",
      dependencies: {
        react: "19.2.8",
        "react-dom": "19.2.8",
        "@module-federation/enhanced": "2.8.2",
      },
    }),
  );
  await fs.writeFile(
    path.join(root, "index.html"),
    '<!doctype html><html><body><script type="module" src="/src/main.ts"></script></body></html>\n',
  );
  await fs.writeFile(
    path.join(root, "src/main.ts"),
    'import "react/jsx-runtime";\nimport "react-dom/client";\nexport {};\n',
  );
  const adapterModuleFederation = {
    ...moduleFederation,
    exposes: { "./App": "./src/main.ts" },
    shared: sharedConfig(false),
  };
  const adapterDoctorConfig = {
    ...doctorConfig(scenario, root),
    moduleFederation: adapterModuleFederation,
    failOn: "never",
  };
  await fs.writeFile(
    path.join(root, "vite.config.ts"),
    `import { federation } from "@module-federation/vite";
import { federationDoctor } from "@tonoizer/mfdoctor/vite";
import { defineConfig } from "vite";

const mfOptions = ${JSON.stringify(adapterModuleFederation)};

export default defineConfig({
  root: ${JSON.stringify(root)},
  plugins: [
    federation(mfOptions),
    federationDoctor({
      ...${JSON.stringify(adapterDoctorConfig)},
      moduleFederation: mfOptions,
    }),
  ],
  build: {
    outDir: ${JSON.stringify(path.join(root, "dist"))},
    emptyOutDir: true,
    target: "esnext",
  },
});
`,
  );
  return root;
}

function assertRecommendationReport(report: Report, scenario: RecommendationScenario): void {
  const expectedPrefixErrors = scenario.expectedPrefix === "absent" ? 0 : 2;
  expect(report.summary.errors, "only React prefix-share gaps should be CI errors").toBe(
    expectedPrefixErrors,
  );

  const observability = report.findings.find(
    (finding) => finding.ruleId === "config/observability-plugin-recommended",
  );
  expect(observability?.severity).toBe(
    scenario.expectedObservability === "absent" ? undefined : scenario.expectedObservability,
  );

  const prefixFindings = report.findings.filter(
    (finding) => finding.ruleId === "shared/prefix-share-recommended",
  );
  expect(prefixFindings).toHaveLength(expectedPrefixErrors);
  if (scenario.expectedPrefix !== "absent") {
    expect(new Set(prefixFindings.map((finding) => finding.severity))).toEqual(
      new Set([scenario.expectedPrefix]),
    );
    expect(
      Object.fromEntries(
        prefixFindings.map((finding) => [finding.evidence?.package, finding.evidence?.specifiers]),
      ),
    ).toEqual({
      react: ["react/jsx-runtime"],
      "react-dom": ["react-dom/client"],
    });
  }

  const offlineRemotes = report.findings.find(
    (finding) => finding.ruleId === "reliability/version-first-offline-remotes",
  );
  expect(offlineRemotes?.severity).toBe(
    scenario.expectedOfflineRemotes === "absent" ? undefined : scenario.expectedOfflineRemotes,
  );
}

test.afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

for (const scenario of scenarios) {
  test(scenario.name, async () => {
    const root = await createProject(scenario);
    const report = await runCliCheck(root, scenario);
    assertRecommendationReport(report, scenario);
  });
}

for (const scenario of adapterScenarios) {
  test(scenario.name, async () => {
    const root = await createViteAdapterProject(scenario);
    try {
      await execFileAsync(
        process.execPath,
        [vite, "build", "--config", path.join(root, "vite.config.ts")],
        {
          cwd: root,
          env: {
            ...process.env,
            CI: scenario.mode === "ci" ? "true" : "false",
            NODE_ENV: scenario.mode === "ci" ? "production" : "development",
          },
          maxBuffer: 4 * 1024 * 1024,
        },
      );
    } catch (error) {
      const result = error as { message?: string; stdout?: string; stderr?: string };
      throw new Error(
        [
          `Vite adapter check failed for ${scenario.name}.`,
          result.message ?? "unknown process error",
          result.stdout ?? "",
          result.stderr ?? "",
        ].join("\n"),
        { cause: error },
      );
    }
    const report = JSON.parse(
      await fs.readFile(path.join(root, ".mf/doctor/report.json"), "utf8"),
    ) as Report;
    assertRecommendationReport(report, scenario);
  });
}
