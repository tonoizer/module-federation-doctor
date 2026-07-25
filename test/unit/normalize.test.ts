import { describe, expect, it } from "vitest";
import { normalizeModuleFederation, packageName } from "../../src/normalize.js";

describe("normalization", () => {
  it("normalizes string and object forms in stable order", () => {
    expect(
      normalizeModuleFederation({
        name: "app",
        exposes: { "./Z": "./z.ts", "./A": { import: "./a.ts" } },
        remotes: {
          shop: "shop@https://example.test/remoteEntry.js",
          cart: { entry: "cart@/remoteEntry.js", shareScope: "cart" },
        },
        shared: {
          react: { singleton: true, requiredVersion: "^19.0.0" },
          "react-dom": "^19.0.0",
        },
      }),
    ).toMatchSnapshot();
  });

  it("understands scoped packages and deep imports", () => {
    expect(packageName("@scope/pkg/deep")).toBe("@scope/pkg");
    expect(packageName("react/jsx-runtime")).toBe("react");
  });
});
