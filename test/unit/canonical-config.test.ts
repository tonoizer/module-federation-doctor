import { describe, expect, it } from "vitest";
import { readCanonicalModuleFederationConfig } from "../../src/canonical-config.js";
import { validatePayload } from "../helpers/schema-contract.js";

describe("canonical config boundary", () => {
  it("keeps real upstream outer arrays, fallback order, false, and extensions", () => {
    const config = readCanonicalModuleFederationConfig(
      {
        exposes: ["./button", { "./card": { import: ["./card", "./fallback"] } }],
        remotes: [{ cart: { external: ["cart@one", "cart@two"], type: "script" } }],
        shared: ["react", { "react-dom": { singleton: false, import: false } }],
        runtimePlugins: [["./plugin", { token: "not-persisted" }]],
        runtime: { plugins: ["./runtime"] },
        bridge: { react: true },
        async: { startup: true },
        experiments: { asyncStartup: true },
        customExtension: { enabled: true },
      },
      { adapter: { name: "webpack", version: "5.0.0", packId: "webpack-5" }, target: "browser" },
    );

    expect(config?.contract.adapter.packId).toBe("webpack-5");
    expect(config?.declared.collections.exposes.map((entry) => entry.key)).toEqual([
      "./button",
      "./card",
    ]);
    expect(config?.declared.collections.exposes[1]?.value.value).toEqual({
      import: ["./card", "./fallback"],
    });
    expect(config?.declared.collections.remotes[0]?.value.value).toEqual({
      external: ["cart@one", "cart@two"],
      type: "script",
    });
    expect(config?.declared.collections.shared[1]?.value.value).toEqual({
      import: false,
      singleton: false,
    });
    expect(config?.extensions[0]?.path).toBe("/customExtension");
    expect(config?.effectiveByBuild).toEqual({});
  });

  it("does not apply defaults and marks executable values opaque", () => {
    const config = readCanonicalModuleFederationConfig({
      shared: { react: {} },
      runtimePlugins: [() => undefined],
    });
    expect(config?.declared.collections.shared[0]?.value.value).toEqual({});
    expect(
      config?.declared.fields.find((entry) => entry.key === "runtimePlugins")?.value.value,
    ).toEqual([{ kind: "opaque", valueType: "function" }]);
    expect(config?.diagnostics.some((diagnostic) => diagnostic.code === "opaque-value")).toBe(true);
  });

  it("returns partial diagnostics for a non-object root", () => {
    const config = readCanonicalModuleFederationConfig(null);
    expect(config?.declared.fields).toEqual([]);
    expect(config?.diagnostics[0]).toMatchObject({ code: "invalid-root", path: "/" });
  });

  it("does not invoke getters while reading object-shaped input", () => {
    let called = false;
    const config = readCanonicalModuleFederationConfig({
      get customExtension() {
        called = true;
        return { enabled: true };
      },
    });
    expect(called).toBe(false);
    expect(config?.declared.fields[0]?.value.value).toEqual({
      kind: "opaque",
      valueType: "undefined",
    });
  });

  it("does not invoke Symbol.toStringTag getters for opaque values", () => {
    let called = false;
    class Tagged {
      get [Symbol.toStringTag]() {
        called = true;
        return "SecretTag";
      }
    }
    const config = readCanonicalModuleFederationConfig({ extension: new Tagged() });
    expect(called).toBe(false);
    expect(config?.extensions[0]?.value).toMatchObject({ kind: "opaque", objectType: "object" });
    expect(
      readCanonicalModuleFederationConfig({ regex: /x/, date: new Date(0) })?.declared.fields.map(
        (field) => field.value.value,
      ),
    ).toEqual([
      { kind: "opaque", objectType: "Date", valueType: "object" },
      { kind: "opaque", objectType: "RegExp", valueType: "object" },
    ]);
  });

  it("marks accessor collections opaque and preserves semantic collection names", () => {
    let called = false;
    const config = readCanonicalModuleFederationConfig({
      get exposes() {
        called = true;
        return ["should-not-run"];
      },
      exposesFallback: ["unused"],
      shared: ["token", "tokenizer", "secret"],
      remotes: { token: "token@https://example.test/remote.js" },
    });
    expect(called).toBe(false);
    expect(config?.declared.collections.exposes[0]?.key).toBe("[opaque]");
    expect(config?.declared.collections.shared.map((entry) => entry.key)).toEqual([
      "token",
      "tokenizer",
      "secret",
    ]);
    expect(config?.declared.collections.remotes[0]?.key).toBe("token");
    expect(config?.diagnostics.some((item) => item.code === "access-error")).toBe(true);
  });

  it("is cycle-safe, bounded, deterministic, and redacts sensitive values", () => {
    const cycle: Record<string, unknown> = {
      password: "secret",
      url: "https://user:pass@example.test/?token=abc",
    };
    cycle.self = cycle;
    const first = readCanonicalModuleFederationConfig(
      { z: 1, a: cycle, regex: /secret/ },
      {},
      { maxDepth: 4, maxNodes: 50 },
    );
    const second = readCanonicalModuleFederationConfig(
      { regex: /secret/, a: cycle, z: 1 },
      {},
      { maxDepth: 4, maxNodes: 50 },
    );
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(JSON.stringify(first)).not.toContain("secret");
    expect(JSON.stringify(first)).not.toContain("token=abc");
    expect(JSON.stringify(first)).not.toContain("password");
    expect(first?.diagnostics.some((item) => item.code === "cycle")).toBe(true);
    expect(first?.diagnostics.some((item) => item.code === "opaque-value")).toBe(true);
    const deep: Record<string, unknown> = {};
    let cursor = deep;
    for (let index = 0; index < 100; index += 1) {
      cursor.next = {};
      cursor = cursor.next as Record<string, unknown>;
    }
    const bounded = readCanonicalModuleFederationConfig(
      { deep },
      {},
      { maxDepth: 8, maxNodes: 100 },
    );
    expect(bounded?.diagnostics.some((item) => item.code === "limit-depth")).toBe(true);
    const limited = readCanonicalModuleFederationConfig(
      { long: "0123456789", many: { a: 1, b: 2 } },
      {},
      { maxStringBytes: 4, maxNodes: 2, maxBytes: 20 },
    );
    expect(limited?.diagnostics.some((item) => item.code === "limit-string")).toBe(true);
    expect(limited?.diagnostics.some((item) => item.code === "limit-nodes")).toBe(true);
    const width = readCanonicalModuleFederationConfig(
      { many: { a: 1, b: 2 } },
      {},
      { maxWidth: 1 },
    );
    expect(width?.diagnostics.some((item) => item.code === "limit-width")).toBe(true);
    const documentWidth = readCanonicalModuleFederationConfig(
      { exposes: ["a", "b"] },
      {},
      { maxWidth: 1 },
    );
    expect(documentWidth?.diagnostics.some((item) => item.code === "limit-width")).toBe(true);
    const documentNodes = readCanonicalModuleFederationConfig({ a: 1, b: 2 }, {}, { maxNodes: 1 });
    expect(documentNodes?.diagnostics.some((item) => item.code === "limit-nodes")).toBe(true);
    const documentBytes = readCanonicalModuleFederationConfig(
      { a: "long", b: "also-long" },
      {},
      { maxBytes: 3 },
    );
    expect(documentBytes?.diagnostics.some((item) => item.code === "limit-bytes")).toBe(true);
  });

  it("does not invoke throwing proxies or revoked proxies", () => {
    let traps = 0;
    const throwing = new Proxy(
      {},
      {
        get: () => {
          traps += 1;
          throw new Error("trap");
        },
        ownKeys: () => {
          traps += 1;
          throw new Error("trap");
        },
      },
    );
    const revokedState = Proxy.revocable({}, {});
    revokedState.revoke();
    expect(() => readCanonicalModuleFederationConfig(throwing)).not.toThrow();
    expect(() => readCanonicalModuleFederationConfig(revokedState.proxy)).not.toThrow();
    expect(traps).toBe(0);
  });

  it("does not persist sensitive root values or collide redacted keys", () => {
    const config = readCanonicalModuleFederationConfig({ token: "secret-token", secret: "secret" });
    const fields = config?.declared.fields ?? [];
    expect(fields.map((field) => field.key)).toHaveLength(2);
    expect(new Set(fields.map((field) => field.id)).size).toBe(2);
    expect(
      fields.every(
        (field) =>
          field.value.value !== null &&
          typeof field.value.value === "object" &&
          !Array.isArray(field.value.value) &&
          "kind" in field.value.value &&
          field.value.value.kind === "opaque",
      ),
    ).toBe(true);
    expect(JSON.stringify(config)).not.toContain("secret-token");
  });

  it("matches the strict shipped schema and rejects malformed documents", async () => {
    const document = readCanonicalModuleFederationConfig({
      exposes: ["./Button"],
      shared: ["react"],
    });
    await validatePayload("config.schema.json", document, "canonical config");
    await expect(
      validatePayload("config.schema.json", { ...document, unexpected: true }, "bad config"),
    ).rejects.toThrow();
    await expect(
      validatePayload(
        "config.schema.json",
        { ...document, diagnostics: [{ code: "nope", path: "/", message: "bad" }] },
        "bad diagnostic",
      ),
    ).rejects.toThrow();
  });
});
