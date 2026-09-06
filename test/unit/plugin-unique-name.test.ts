import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { UnpluginOptions } from "unplugin";
import { rspackDoctor, webpackDoctor } from "../../src/plugin.js";
import type { RuleSetting } from "../../src/types.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

const quietRules = {
  "artifact/remote-entry-missing": "off",
  "artifact/types-missing": "off",
  "artifact/expose-missing": "off",
  "config/plugin-package-mismatch": "off",
  "doctor/partial-analysis": "off",
} satisfies Record<string, RuleSetting>;

async function makeRoot(name: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `mfdoctor-${name}-`));
  roots.push(root);
  await fs.mkdir(path.join(root, "src"));
  await fs.writeFile(path.join(root, "src/Widget.ts"), "export {};\n");
  await fs.mkdir(path.join(root, "dist"));
  await fs.writeFile(path.join(root, "dist/remoteEntry.js"), "export {};\n");
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name,
      dependencies: { "@module-federation/enhanced": "1.0.0" },
    }),
  );
  return root;
}

function asSinglePlugin(value: UnpluginOptions | UnpluginOptions[]): UnpluginOptions {
  expect(Array.isArray(value)).toBe(false);
  return value as UnpluginOptions;
}

async function emitWebpack(
  root: string,
  options: {
    uniqueName?: string;
    federationName?: string;
  },
): Promise<{
  project: { bundler: { outputUniqueName?: string } };
  report: { findings: Array<{ ruleId: string; severity: string }> };
}> {
  const taps: Array<
    (compilation: { assets: Record<string, unknown>; errors: Error[] }) => Promise<void>
  > = [];
  const compiler = {
    context: root,
    options: {
      mode: "production",
      output: {
        path: path.join(root, "dist"),
        ...(options.uniqueName !== undefined ? { uniqueName: options.uniqueName } : {}),
      },
    },
    hooks: {
      afterEmit: {
        tapPromise(
          _name: string,
          fn: (compilation: { assets: Record<string, unknown>; errors: Error[] }) => Promise<void>,
        ) {
          taps.push(fn);
        },
      },
    },
  };
  const raw = webpackDoctor.raw(
    {
      root,
      moduleFederation: {
        name: options.federationName ?? "shop",
        filename: "remoteEntry.js",
        exposes: { "./Widget": "./src/Widget.ts" },
        shared: {},
      },
      mode: "ci",
      output: { formats: ["json"] },
      rules: quietRules,
    },
    { framework: "webpack", versions: { unplugin: "3.3.0" }, webpack: { compiler } } as never,
  );
  asSinglePlugin(raw).webpack!(compiler as never);
  await taps[0]!({ assets: { "remoteEntry.js": {} }, errors: [] });
  return {
    project: JSON.parse(await fs.readFile(path.join(root, ".mf/doctor/project.json"), "utf8")),
    report: JSON.parse(await fs.readFile(path.join(root, ".mf/doctor/report.json"), "utf8")),
  };
}

describe("output.uniqueName adapter facts", () => {
  it("records webpack uniqueName and reports info when it disagrees with federation name", async () => {
    const root = await makeRoot("webpack-unique-name-mismatch");
    const { project, report } = await emitWebpack(root, { uniqueName: "other_runtime" });
    expect(project.bundler.outputUniqueName).toBe("other_runtime");
    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: "config/unique-name-mismatch",
          severity: "info",
        }),
      ]),
    );
  });

  it("stays quiet when uniqueName is absent", async () => {
    const root = await makeRoot("webpack-unique-name-absent");
    const { project, report } = await emitWebpack(root, {});
    expect(project.bundler.outputUniqueName).toBeUndefined();
    expect(
      report.findings.some((finding) => finding.ruleId === "config/unique-name-mismatch"),
    ).toBe(false);
  });

  it("stays quiet when uniqueName equals federation name", async () => {
    const root = await makeRoot("webpack-unique-name-aligned");
    const { project, report } = await emitWebpack(root, {
      uniqueName: "shop",
      federationName: "shop",
    });
    expect(project.bundler.outputUniqueName).toBe("shop");
    expect(
      report.findings.some((finding) => finding.ruleId === "config/unique-name-mismatch"),
    ).toBe(false);
  });

  it("records rspack uniqueName the same way", async () => {
    const root = await makeRoot("rspack-unique-name-mismatch");
    const taps: Array<
      (compilation: { assets: Record<string, unknown>; errors: Error[] }) => Promise<void>
    > = [];
    const compiler = {
      context: root,
      options: {
        mode: "production",
        output: { path: path.join(root, "dist"), uniqueName: "rspack_runtime" },
      },
      hooks: {
        afterEmit: {
          tapPromise(
            _name: string,
            fn: (compilation: {
              assets: Record<string, unknown>;
              errors: Error[];
            }) => Promise<void>,
          ) {
            taps.push(fn);
          },
        },
      },
    };
    const raw = rspackDoctor.raw(
      {
        root,
        moduleFederation: {
          name: "rspack_shop",
          filename: "remoteEntry.js",
          exposes: {},
          shared: {},
        },
        mode: "ci",
        output: { formats: ["json"] },
        rules: quietRules,
      },
      { framework: "rspack", versions: { unplugin: "3.3.0" }, rspack: { compiler } } as never,
    );
    asSinglePlugin(raw).rspack!(compiler as never);
    await taps[0]!({ assets: { "remoteEntry.js": {} }, errors: [] });

    const project = JSON.parse(
      await fs.readFile(path.join(root, ".mf/doctor/project.json"), "utf8"),
    ) as { bundler: { outputUniqueName?: string } };
    const report = JSON.parse(
      await fs.readFile(path.join(root, ".mf/doctor/report.json"), "utf8"),
    ) as { findings: Array<{ ruleId: string }> };
    expect(project.bundler.outputUniqueName).toBe("rspack_runtime");
    expect(
      report.findings.some((finding) => finding.ruleId === "config/unique-name-mismatch"),
    ).toBe(true);
  });
});
