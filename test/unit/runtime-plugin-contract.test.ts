import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { analyze } from "../../src/engine.js";
import { inspectCorsParity, inspectPluginFactory } from "../../src/runtime-plugin-contract.js";

const roots: string[] = [];

async function fixtureRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-runtime-plugin-"));
  roots.push(root);
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "fixture",
      dependencies: { "@module-federation/vite": "2.8.0" },
    }),
  );
  await fs.writeFile(path.join(root, "src/index.ts"), "export {};\n");
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("inspectPluginFactory", () => {
  it("flags missing exports and non-factory defaults", () => {
    expect(inspectPluginFactory("const x = 1;\n").kind).toBe("invalid-factory");
    expect(inspectPluginFactory("export default 42;\n").kind).toBe("invalid-factory");
    expect(inspectPluginFactory("export default {};\n").kind).toBe("invalid-factory");
  });

  it("flags factories that return objects without name", () => {
    const source = `export default function plugin() {
  return {
    createScript() {},
  };
}
`;
    const result = inspectPluginFactory(source);
    expect(result).toEqual({ kind: "invalid-factory", reason: "missing-name" });
  });

  it("accepts a named factory and skips ambiguous modules", () => {
    const ok = `export default function plugin() {
  return {
    name: "ok-plugin",
    createScript() {},
  };
}
`;
    expect(inspectPluginFactory(ok).kind).toBe("ok");
    const ambiguous = `export default function plugin() {
  return buildPlugin();
}
`;
    expect(inspectPluginFactory(ambiguous).kind).toBe("skip");
  });
});

describe("inspectCorsParity", () => {
  it("reports clear CORS asymmetry when createLink is missing", () => {
    const source = `export default function plugin() {
  return {
    name: "cors",
    createScript({ url }) {
      const script = document.createElement("script");
      script.src = url;
      script.crossOrigin = "anonymous";
      return script;
    },
  };
}
`;
    expect(inspectCorsParity(source)).toEqual({
      kind: "cors-parity",
      reason: "create-script-without-create-link",
      confidence: "clear",
    });
  });

  it("reports heuristic when createScript exists without CORS attrs or createLink", () => {
    const source = `export default function plugin() {
  return {
    name: "loader",
    createScript({ url }) {
      const script = document.createElement("script");
      script.src = url;
      return script;
    },
  };
}
`;
    expect(inspectCorsParity(source)).toEqual({
      kind: "cors-parity",
      reason: "create-script-without-create-link",
      confidence: "heuristic",
    });
  });

  it("does not invent clear CORS fails when hook bodies cannot be bounded", () => {
    const source = `export default function plugin() {
  const note = "anonymous";
  return {
    name: "opaque",
    createScript(args) {
      return customize(args);
    },
  };
}
`;
    expect(inspectCorsParity(source)).toEqual({
      kind: "cors-parity",
      reason: "create-script-without-create-link",
      confidence: "heuristic",
    });
  });

  it("is quiet when createScript and createLink both set CORS", () => {
    const source = `export default function plugin() {
  return {
    name: "cors",
    createScript({ url }) {
      const script = document.createElement("script");
      script.crossOrigin = "anonymous";
      script.src = url;
      return script;
    },
    createLink({ url }) {
      const link = document.createElement("link");
      link.setAttribute("crossorigin", "anonymous");
      link.href = url;
      return link;
    },
  };
}
`;
    expect(inspectCorsParity(source).kind).toBe("ok");
  });
});

describe("runtime-plugins rules via analyze", () => {
  async function run(root: string, plugin: string) {
    return analyze({
      root,
      bundler: "vite",
      output: { formats: [] },
      moduleFederation: {
        name: "fixture",
        runtimePlugins: [plugin],
      },
      rules: {
        "artifact/remote-entry-missing": "off",
        "artifact/types-missing": "off",
        "config/plugin-package-mismatch": "off",
        "doctor/partial-analysis": "off",
        "config/runtime-plugin-missing": "off",
      },
    });
  }

  it("reports invalid factory and stays silent with no custom plugins", async () => {
    const root = await fixtureRoot();
    await fs.writeFile(path.join(root, "src/bad-plugin.ts"), "export default null;\n");
    const bad = await run(root, "./src/bad-plugin.ts");
    expect(bad.report.findings.map((f) => f.ruleId)).toContain("runtime-plugins/invalid-factory");
    expect(
      bad.report.findings.find((f) => f.ruleId === "runtime-plugins/invalid-factory")?.severity,
    ).toBe("warning");

    const quiet = await analyze({
      root,
      bundler: "vite",
      output: { formats: [] },
      moduleFederation: { name: "fixture", runtimePlugins: [] },
      rules: {
        "artifact/remote-entry-missing": "off",
        "artifact/types-missing": "off",
        "config/plugin-package-mismatch": "off",
        "doctor/partial-analysis": "off",
      },
    });
    expect(quiet.report.findings.some((f) => f.ruleId.startsWith("runtime-plugins/"))).toBe(false);
  });

  it("reports CORS parity warning and skips unreadable package plugins", async () => {
    const root = await fixtureRoot();
    await fs.writeFile(
      path.join(root, "src/cors-plugin.ts"),
      `export default function plugin() {
  return {
    name: "cors",
    createScript({ url }) {
      const script = document.createElement("script");
      script.src = url;
      script.crossOrigin = "anonymous";
      return script;
    },
  };
}
`,
    );
    const result = await run(root, "./src/cors-plugin.ts");
    expect(result.report.findings.map((f) => f.ruleId)).toContain(
      "runtime-plugins/create-script-cors-parity",
    );

    const packaged = await run(root, "@module-federation/retry-plugin");
    expect(packaged.report.findings.some((f) => f.ruleId.startsWith("runtime-plugins/"))).toBe(
      false,
    );
  });

  it("does not invent a fail for an unreadable local path", async () => {
    const root = await fixtureRoot();
    // Missing local file: runtime-plugin-missing may fire, but contract rules must skip.
    const result = await analyze({
      root,
      bundler: "vite",
      output: { formats: [] },
      moduleFederation: {
        name: "fixture",
        runtimePlugins: ["./src/does-not-exist.ts"],
      },
      rules: {
        "artifact/remote-entry-missing": "off",
        "artifact/types-missing": "off",
        "config/plugin-package-mismatch": "off",
        "doctor/partial-analysis": "off",
        "config/runtime-plugin-missing": "off",
      },
    });
    expect(result.report.findings.some((f) => f.ruleId.startsWith("runtime-plugins/"))).toBe(false);
  });
});
