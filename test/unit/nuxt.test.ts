import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import createNuxtDoctorModuleDefault, {
  createNuxtDoctorModule,
  moduleFederationDoctor,
} from "../../src/nuxt.js";
import type { NuxtModuleContext } from "../../src/nuxt.js";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function nuxtContext(version: "3" | "4") {
  const callbacks: Array<(config: { plugins?: unknown[] }) => void> = [];
  const context: NuxtModuleContext = {
    options:
      version === "3"
        ? { rootDir: "C:/fixtures/nuxt-3" }
        : {
            rootDir: "C:/fixtures/nuxt-4",
            moduleFederation: {
              config: {
                name: "nuxt-host",
                remotes: { remote: "http://127.0.0.1:4174/remoteEntry.js" },
              },
            },
          },
    hook(_name, callback) {
      callbacks.push(callback);
    },
  };
  return { context, callbacks };
}

describe("Nuxt adapter", () => {
  it.each(["3", "4"] as const)("registers one Vite plugin for Nuxt %s", (version) => {
    const { context, callbacks } = nuxtContext(version);
    const module = createNuxtDoctorModule({
      mode: "ci",
      output: { formats: [] },
      moduleFederation: {
        name: `nuxt-${version}`,
        exposes: { "./Widget": "./src/Widget.ts" },
        remotes: {},
      },
    });

    expect(typeof module).toBe("function");
    module({}, context);
    expect(callbacks).toHaveLength(1);

    const config: { plugins?: unknown[] } = {};
    callbacks[0]!(config);
    expect(config.plugins).toHaveLength(1);
    expect(config.plugins?.[0]).toMatchObject({ name: "module-federation-doctor" });
  });

  it("reads the Nuxt 4 module federation config when no explicit config is passed", () => {
    const { context, callbacks } = nuxtContext("4");
    moduleFederationDoctor.setup({ mode: "ci", output: { formats: [] } }, context);

    const config: { plugins?: unknown[] } = { plugins: [] };
    callbacks[0]!(config);
    expect(config.plugins).toHaveLength(1);
  });

  it("exposes one factory and a default module instance", () => {
    expect(typeof createNuxtDoctorModule).toBe("function");
    expect(createNuxtDoctorModuleDefault).toBe(moduleFederationDoctor);
    expect(typeof moduleFederationDoctor.setup).toBe("function");
  });

  it("ships a copyable compatibility smoke that registers the Nuxt module", async () => {
    const source = await readFile(
      path.join(repository, "examples/compatibility/nuxt/nuxt.config.mjs"),
      "utf8",
    );
    expect(source).toContain('"@tonoizer/mfdoctor/nuxt"');
    expect(source).toContain('name: "nuxt_smoke"');
  });

  it("does not duplicate the plugin when Nuxt invokes the hook twice", () => {
    const { context, callbacks } = nuxtContext("3");
    createNuxtDoctorModule({ output: { formats: [] } }).setup({}, context);

    const config: { plugins?: unknown[] } = { plugins: [] };
    callbacks[0]!(config);
    callbacks[0]!(config);
    expect(config.plugins).toHaveLength(1);
  });
});
