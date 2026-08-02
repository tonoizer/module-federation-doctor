import { describe, expect, it } from "vitest";
import {
  BUILT_IN_CAPABILITY_PACKS,
  ENHANCED_WEBPACK_V5_BROWSER_PACK,
  assertCapabilityPacks,
  queryCapability,
  resolveCapabilityPack,
  type CapabilityPack,
} from "../../src/capability-packs.js";

const webpackV5: CapabilityPack = {
  id: "webpack-enhanced-v5-browser",
  core: { name: "@module-federation/core", version: ">=0.8 <1" },
  adapter: { name: "webpack", version: ">=5 <6" },
  bundler: { name: "webpack", version: ">=5 <6" },
  target: "browser",
  fields: {
    manifest: { status: "supported", acceptedForms: ["boolean", "object"] },
  },
};

const unknownWebpack: CapabilityPack = {
  id: "webpack-unknown-browser",
  core: { name: "@module-federation/core", version: "unknown" },
  adapter: { name: "webpack", version: "unknown" },
  bundler: { name: "webpack", version: "unknown" },
  target: "browser",
  fields: {},
};

describe("capability pack resolver", () => {
  it("matches the pinned Enhanced Webpack browser pack", () => {
    const resolution = resolveCapabilityPack(
      {
        core: { name: "@module-federation/sdk", version: "2.7.0" },
        adapter: { name: "@module-federation/enhanced", version: "2.7.0" },
        bundler: { name: "webpack", version: "5.99.0" },
        target: "browser",
      },
      BUILT_IN_CAPABILITY_PACKS,
    );

    expect(resolution).toMatchObject({
      status: "matched",
      pack: { id: ENHANCED_WEBPACK_V5_BROWSER_PACK.id },
    });
    expect(ENHANCED_WEBPACK_V5_BROWSER_PACK.provenance).toMatchObject({
      source: "module-federation/core@d927242",
      commit: "d927242",
      package: "@module-federation/sdk",
      version: "2.7.0",
    });
    expect(ENHANCED_WEBPACK_V5_BROWSER_PACK.core).toEqual({
      name: "@module-federation/sdk",
      version: ">=2.7.0 <2.8.0",
    });
    expect(ENHANCED_WEBPACK_V5_BROWSER_PACK.provenance?.reviewedFiles).toContain(
      "packages/sdk/src/types/plugins/ModuleFederationPlugin.ts",
    );
  });

  it("keeps target and version mismatches unknown", () => {
    const query = {
      core: { name: "@module-federation/sdk", version: "2.7.0" },
      adapter: { name: "@module-federation/enhanced", version: "2.8.0" },
      bundler: { name: "webpack", version: "5.99.0" },
      target: "node",
    };
    expect(resolveCapabilityPack(query, BUILT_IN_CAPABILITY_PACKS)).toMatchObject({
      status: "unknown",
      reason: "no-match",
    });
    expect(
      resolveCapabilityPack(
        { ...query, target: "browser", adapter: { ...query.adapter, version: "unknown" } },
        BUILT_IN_CAPABILITY_PACKS,
      ),
    ).toMatchObject({ status: "unknown", reason: "missing-version" });
  });

  it("reports the first pack field capabilities without changing them", () => {
    const resolution = { status: "matched", pack: ENHANCED_WEBPACK_V5_BROWSER_PACK } as const;
    expect(queryCapability(resolution, "exposes").acceptedForms).toContain("outer-array");
    expect(queryCapability(resolution, "remotes.external").acceptedForms).toContain("array");
    expect(queryCapability(resolution, "shared.import").acceptedForms).toContain("false");
    expect(queryCapability(resolution, "runtimePlugins").acceptedForms).toContain("tuple");
    expect(queryCapability(resolution, "manifest").acceptedForms).toEqual(["boolean", "object"]);
    expect(queryCapability(resolution, "async").acceptedForms).toContain("object");
    expect(queryCapability(resolution, "treeShaking").status).toBe("supported");
  });

  it("matches known versions and exposes field capability", () => {
    const resolution = resolveCapabilityPack(
      {
        core: { name: "@module-federation/core", version: "0.9.0" },
        adapter: { name: "webpack", version: "5.99.0" },
        bundler: { name: "webpack", version: "5.99.0" },
        target: "browser",
      },
      [webpackV5],
    );

    expect(resolution).toMatchObject({ status: "matched", pack: { id: webpackV5.id } });
    expect(queryCapability(resolution, "manifest")).toEqual({
      status: "supported",
      acceptedForms: ["boolean", "object"],
    });
  });

  it("does not inherit a versioned pack when version evidence is missing", () => {
    const resolution = resolveCapabilityPack(
      {
        core: { name: "@module-federation/core" },
        adapter: { name: "webpack" },
        bundler: { name: "webpack" },
        target: "browser",
      },
      [webpackV5],
    );

    expect(resolution).toEqual({
      status: "unknown",
      reason: "missing-version",
      candidates: [webpackV5.id],
    });
    expect(queryCapability(resolution, "manifest")).toEqual({
      status: "unknown",
      acceptedForms: [],
    });
  });

  it("allows an explicit unknown-version pack", () => {
    const resolution = resolveCapabilityPack(
      {
        core: { name: "@module-federation/core" },
        adapter: { name: "webpack" },
        bundler: { name: "webpack" },
        target: "browser",
      },
      [webpackV5, unknownWebpack],
    );

    expect(resolution).toMatchObject({ status: "matched", pack: { id: unknownWebpack.id } });
  });

  it("does not silently choose an overlapping pack", () => {
    const overlapping = {
      ...webpackV5,
      id: "webpack-enhanced-v5-overlap",
      adapter: { name: "webpack", version: ">=5.5 <6" },
    };
    const resolution = resolveCapabilityPack(
      {
        core: { name: "@module-federation/core", version: "0.9.0" },
        adapter: { name: "webpack", version: "5.99.0" },
        bundler: { name: "webpack", version: "5.99.0" },
        target: "browser",
      },
      [webpackV5, overlapping],
    );

    expect(resolution).toEqual({
      status: "ambiguous",
      candidates: [webpackV5.id, overlapping.id].sort(),
    });
  });

  it("matches the MF core contract version as a distinct dimension", () => {
    const coreMismatch = resolveCapabilityPack(
      {
        core: { name: "@module-federation/core", version: "1.0.0" },
        adapter: { name: "webpack", version: "5.99.0" },
        bundler: { name: "webpack", version: "5.99.0" },
        target: "browser",
      },
      [webpackV5],
    );

    expect(coreMismatch).toEqual({
      status: "unknown",
      reason: "no-match",
      candidates: [webpackV5.id],
    });
  });

  it("reports ambiguity when core contract ranges overlap", () => {
    const overlapping = {
      ...webpackV5,
      id: "webpack-enhanced-core-overlap",
      core: { name: "@module-federation/core", version: ">=0.9 <1" },
    };
    const resolution = resolveCapabilityPack(
      {
        core: { name: "@module-federation/core", version: "0.9.0" },
        adapter: { name: "webpack", version: "5.99.0" },
        bundler: { name: "webpack", version: "5.99.0" },
        target: "browser",
      },
      [webpackV5, overlapping],
    );

    expect(resolution).toEqual({
      status: "ambiguous",
      candidates: [webpackV5.id, overlapping.id].sort(),
    });
  });

  it("does not resolve inherited or reserved field names", () => {
    const resolution = resolveCapabilityPack(
      {
        core: { name: "@module-federation/core", version: "0.9.0" },
        adapter: { name: "webpack", version: "5.99.0" },
        bundler: { name: "webpack", version: "5.99.0" },
        target: "browser",
      },
      [webpackV5],
    );

    expect(queryCapability(resolution, "toString")).toEqual({
      status: "unknown",
      acceptedForms: [],
    });
    expect(queryCapability(resolution, "__proto__")).toEqual({
      status: "unknown",
      acceptedForms: [],
    });
  });

  it("rejects duplicate ids and invalid version selectors", () => {
    expect(() => assertCapabilityPacks([webpackV5, { ...webpackV5 }])).toThrow(/id is not unique/);
    expect(() =>
      assertCapabilityPacks([
        { ...webpackV5, adapter: { name: "webpack", version: "not-a-range" } },
      ]),
    ).toThrow(/invalid version selector/);
  });
});
