import { describe, expect, it } from "vitest";
import * as modern from "../../src/modern.js";
import * as nuxt from "../../src/nuxt.js";
import * as rsbuild from "../../src/rsbuild.js";
import * as rspack from "../../src/rspack.js";
import * as vite from "../../src/vite.js";
import * as webpack from "../../src/webpack.js";

describe("adapter public exports", () => {
  it("keeps idiomatic factories and drops unused doctor aliases", () => {
    expect(typeof vite.federationDoctor).toBe("function");
    expect(vite.default).toBe(vite.federationDoctor);
    expect(vite).not.toHaveProperty("doctor");

    expect(typeof rspack.moduleFederationDoctorPlugin).toBe("function");
    expect(rspack.default).toBe(rspack.moduleFederationDoctorPlugin);
    expect(rspack).not.toHaveProperty("doctor");

    expect(typeof rsbuild.pluginModuleFederationDoctor).toBe("function");
    expect(rsbuild.default).toBe(rsbuild.pluginModuleFederationDoctor);
    expect(rsbuild).not.toHaveProperty("doctor");

    expect(typeof webpack.ModuleFederationDoctorPlugin).toBe("function");
    expect(webpack).not.toHaveProperty("moduleFederationDoctorPlugin");
    expect(webpack.default).toBe(webpack.ModuleFederationDoctorPlugin);
    expect(webpack).not.toHaveProperty("doctor");

    expect(typeof modern.moduleFederationDoctorPlugin).toBe("function");
    expect(typeof modern.appendModuleFederationDoctor).toBe("function");
    expect(modern.default).toBe(modern.moduleFederationDoctorPlugin);
    expect(modern).not.toHaveProperty("doctor");
  });

  it("leaves Nuxt compatibility aliases in place", () => {
    expect(nuxt.nuxtDoctor).toBe(nuxt.moduleFederationDoctor);
    expect(nuxt.federationDoctorNuxt).toBe(nuxt.moduleFederationDoctor);
    expect(nuxt.default).toBe(nuxt.moduleFederationDoctor);
  });
});
