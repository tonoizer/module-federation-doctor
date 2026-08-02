import { describe, expect, it } from "vitest";
import {
  assertCapabilityPacks,
  queryCapability,
  resolveCapabilityPack,
  type CapabilityPack,
} from "../../src/capability-packs.js";

const webpackV5: CapabilityPack = {
  id: "webpack-enhanced-v5-browser",
  adapter: { name: "webpack", version: ">=5 <6" },
  bundler: { name: "webpack", version: ">=5 <6" },
  target: "browser",
  fields: {
    manifest: { status: "supported", acceptedForms: ["boolean", "object"] },
  },
};

const unknownWebpack: CapabilityPack = {
  id: "webpack-unknown-browser",
  adapter: { name: "webpack", version: "unknown" },
  bundler: { name: "webpack", version: "unknown" },
  target: "browser",
  fields: {},
};

describe("capability pack resolver", () => {
  it("matches known versions and exposes field capability", () => {
    const resolution = resolveCapabilityPack(
      {
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

  it("rejects duplicate ids and invalid version selectors", () => {
    expect(() => assertCapabilityPacks([webpackV5, { ...webpackV5 }])).toThrow(/id is not unique/);
    expect(() =>
      assertCapabilityPacks([
        { ...webpackV5, adapter: { name: "webpack", version: "not-a-range" } },
      ]),
    ).toThrow(/invalid version selector/);
  });
});
