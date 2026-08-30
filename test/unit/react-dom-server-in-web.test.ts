import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validatePayload } from "../helpers/schema-contract.js";
import {
  collectReactDomServerSignals,
  isReactDomServerSpecifier,
  isWebClientArtifactTarget,
} from "../../src/react-dom-server.js";
import { builtInRules } from "../../src/rules.js";
import type { BuildRecord, DoctorFinding, ProjectFacts } from "../../src/types.js";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RULE_ID = "artifact/react-dom-server-in-web";

function presentCapability(
  reason = "test",
): BuildRecord["capabilities"][keyof BuildRecord["capabilities"]] {
  return { state: "exact", reason };
}

function buildRecord(
  id: string,
  targetKind: BuildRecord["targetKind"],
  target?: string,
): BuildRecord {
  return {
    id,
    adapter: "rspack",
    bundler: "rspack",
    emittedAssets: [],
    artifacts: [],
    ...(target ? { target } : {}),
    ...(targetKind ? { targetKind } : {}),
    capabilities: {
      outputRoot: presentCapability(),
      emittedAssets: presentCapability(),
      artifacts: presentCapability(),
      effectiveMode: presentCapability(),
      target: presentCapability(),
    },
    sourceHook: "test",
  };
}

function baseFacts(): ProjectFacts {
  return {
    schemaVersion: 1,
    project: { name: "web-fixture", root: "." },
    bundler: { name: "rspack", mode: "ci" },
    capabilities: {
      config: true,
      sourceImports: true,
      manifest: false,
      stats: false,
      emittedAssets: true,
      installedVersions: true,
    },
    moduleFederation: {
      name: "web_remote",
      exposes: { "./Widget": "./src/Widget.tsx" },
      remotes: {},
      shared: {},
      experiments: {
        asyncStartup: false,
        externalRuntime: false,
        provideExternalRuntime: false,
        target: "web",
      },
    },
    dependencies: {
      declared: { react: "^19.0.0", "react-dom": "^19.0.0" },
      installed: {},
    },
    imports: {
      sourceFiles: ["src/Widget.tsx"],
      specifiers: ["react-dom/server"],
      packages: ["react-dom"],
      dynamicPackages: [],
      remotes: [],
      unresolvedDynamic: [],
      deepImports: ["react-dom/server"],
      evidenceSources: ["source"],
    },
    artifacts: { emittedAssets: ["remoteEntry.js"] },
  };
}

async function run(facts: ProjectFacts, options: Record<string, unknown> = {}) {
  const findings: Array<
    Omit<DoctorFinding, "schemaVersion" | "ruleId" | "severity" | "project" | "fingerprint">
  > = [];
  const selected = builtInRules.find((item) => item.meta.id === RULE_ID)!;
  await selected.check({ facts, options, report: (finding) => findings.push(finding) });
  return findings;
}

async function readJson<T>(relativePath: string): Promise<T> {
  const text = await fs.readFile(path.join(repository, relativePath), "utf8");
  return JSON.parse(text) as T;
}

describe("artifact/react-dom-server-in-web (#329)", () => {
  it("recognizes react-dom/server entry variants", () => {
    expect(isReactDomServerSpecifier("react-dom/server")).toBe(true);
    expect(isReactDomServerSpecifier("react-dom/server.browser")).toBe(true);
    expect(isReactDomServerSpecifier("react-dom/server.node")).toBe(true);
    expect(isReactDomServerSpecifier("react-dom/server.edge")).toBe(true);
    expect(isReactDomServerSpecifier("react-dom/client")).toBe(false);
    expect(isReactDomServerSpecifier("react-dom")).toBe(false);
  });

  it("fires on web targets that import react-dom/server", async () => {
    const findings = await run(baseFacts());
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toMatch(/react-dom\/server/);
    expect(findings[0]?.evidence).toMatchObject({ entries: ["react-dom/server"] });
    expect(findings[0]?.detailsSchema).toBe("artifact.v1");
    expect(findings[0]?.details).toMatchObject({ entries: ["react-dom/server"] });
  });

  it("fires on react-dom/server.edge and asset-path signals", async () => {
    const facts = baseFacts();
    facts.imports.specifiers = ["react-dom/server.edge"];
    facts.imports.deepImports = ["react-dom/server.edge"];
    facts.artifacts.emittedAssets = ["assets/react-dom-server.js"];
    const findings = await run(facts);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.evidence.entries).toEqual([
      "assets/react-dom-server.js",
      "react-dom/server.edge",
    ]);
  });

  it("stays quiet for node/SSR targets", async () => {
    const facts = baseFacts();
    facts.moduleFederation!.experiments!.target = "node";
    expect(await run(facts)).toHaveLength(0);

    facts.moduleFederation!.experiments!.target = "web";
    facts.moduleFederation!.vite = {
      bundleAllCSS: false,
      ignoreOrigin: false,
      ssrExternals: [],
      target: "node",
    };
    expect(await run(facts)).toHaveLength(0);

    facts.moduleFederation!.vite = undefined;
    facts.builds = [buildRecord("ssr", "ssr", "node")];
    expect(await run(facts)).toHaveLength(0);
    expect(isWebClientArtifactTarget(facts)).toBe(false);
  });

  it("stays quiet for dual web+SSR builds (pass-unknown)", async () => {
    const facts = baseFacts();
    facts.builds = [buildRecord("web", "web"), buildRecord("ssr", "ssr")];
    expect(isWebClientArtifactTarget(facts)).toBe(false);
    expect(await run(facts)).toHaveLength(0);
    expect(await run(facts, { ssrMode: "dual" })).toHaveLength(0);
    expect(await run(facts, { ssrMode: "browser-only" })).toHaveLength(1);
  });

  it("stays quiet without react-dom/server signals", async () => {
    const facts = baseFacts();
    facts.imports.specifiers = ["react-dom/client"];
    facts.imports.deepImports = ["react-dom/client"];
    expect(
      collectReactDomServerSignals({
        specifiers: facts.imports.specifiers,
        deepImports: facts.imports.deepImports,
      }),
    ).toEqual([]);
    expect(await run(facts)).toHaveLength(0);
  });

  it("loads the offline web/ssr fixtures", async () => {
    const web = await readJson<ProjectFacts>(
      "fixtures/artifact-react-dom-server-in-web/web/.mf/doctor/project.json",
    );
    const ssr = await readJson<ProjectFacts>(
      "fixtures/artifact-react-dom-server-in-web/ssr/.mf/doctor/project.json",
    );
    await validatePayload(
      "project.schema.json",
      web,
      "fixtures/artifact-react-dom-server-in-web/web/.mf/doctor/project.json",
    );
    await validatePayload(
      "project.schema.json",
      ssr,
      "fixtures/artifact-react-dom-server-in-web/ssr/.mf/doctor/project.json",
    );

    expect(await run(web)).toHaveLength(1);
    expect(await run(ssr)).toHaveLength(0);

    const widget = await fs.readFile(
      path.join(repository, "fixtures/artifact-react-dom-server-in-web/web/src/Widget.tsx"),
      "utf8",
    );
    const render = await fs.readFile(
      path.join(repository, "fixtures/artifact-react-dom-server-in-web/ssr/src/render.tsx"),
      "utf8",
    );
    expect(widget).toMatch(/react-dom\/server/);
    expect(render).toMatch(/react-dom\/server/);
  });
});
