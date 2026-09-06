import { describe, expect, it } from "vitest";
import { extractPublicExternals } from "../../src/bundler-externals.js";

describe("extractPublicExternals", () => {
  it("reads string, array, and object-key forms", () => {
    expect(extractPublicExternals("react")).toEqual(["react"]);
    expect(extractPublicExternals(["react", "lodash"])).toEqual(["lodash", "react"]);
    expect(extractPublicExternals({ react: "React", lodash: "_" })).toEqual(["lodash", "react"]);
  });

  it("walks nested arrays of objects and skips functions and regex", () => {
    expect(
      extractPublicExternals([
        "react",
        { lodash: "_" },
        () => undefined,
        /^jquery/,
        ["vue", { "react-dom": "ReactDOM" }],
      ]),
    ).toEqual(["lodash", "react", "react-dom", "vue"]);
  });

  it("returns an empty list when nothing extractable is present", () => {
    expect(extractPublicExternals(undefined)).toEqual([]);
    expect(extractPublicExternals(() => undefined)).toEqual([]);
    expect(extractPublicExternals(/^react/)).toEqual([]);
    expect(extractPublicExternals([])).toEqual([]);
  });
});
