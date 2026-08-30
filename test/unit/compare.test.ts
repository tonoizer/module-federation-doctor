import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer, type RequestListener, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  compareManifests,
  compareToSarif,
  formatCompareTerminal,
  writeCompareReports,
} from "../../src/compare.js";
import { main, parseArgs } from "../../src/cli.js";
import { ProbeError } from "../../src/probe.js";
import { validatePayload } from "../helpers/schema-contract.js";

const servers: Server[] = [];
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          ),
      ),
  );
});

async function serve(handler: RequestListener): Promise<{ origin: string }> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test server address.");
  return { origin: `http://127.0.0.1:${address.port}` };
}

function manifestBody(
  origin: string,
  overrides: {
    name?: string;
    exposes?: unknown[];
    shared?: unknown[];
    publicPath?: string;
    remoteEntryPath?: string;
  } = {},
): string {
  return JSON.stringify({
    id: overrides.name ?? "checkout",
    name: overrides.name ?? "checkout",
    metaData: {
      publicPath: overrides.publicPath ?? `${origin}/assets/`,
      remoteEntry: {
        path: overrides.remoteEntryPath ?? "../remoteEntry.js",
        name: "remoteEntry.js",
      },
    },
    exposes: overrides.exposes ?? [{ name: "./Cart" }],
    shared: overrides.shared ?? [{ name: "react", version: "18.3.1" }],
    remotes: [],
  });
}

describe("manifest compare", () => {
  it("reports no diffs for matching manifests", async () => {
    const { origin } = await serve((_request, response) => {
      const body = manifestBody(origin);
      response.writeHead(200, {
        "content-type": "application/json",
        "content-length": body.length,
      });
      response.end(body);
    });

    const result = await compareManifests([
      `${origin}/a/mf-manifest.json`,
      `${origin}/b/mf-manifest.json`,
    ]);
    expect(result.equal).toBe(true);
    expect(result.diffs).toEqual([]);
    expect(result.baseline.name).toBe("checkout");
    expect(result.baseline.exposes).toEqual(["./Cart"]);
    expect(result.baseline.shared).toEqual([{ name: "react", version: "18.3.1" }]);
    await validatePayload("compare.schema.json", result, "compare equal");
  });

  it("diffs name, exposes, shared, publicPath, and remoteEntry", async () => {
    const { origin: leftOrigin } = await serve((_request, response) => {
      const body = manifestBody(leftOrigin, {
        name: "checkout",
        exposes: [{ name: "./Cart" }],
        shared: [{ name: "react", version: "18.3.1" }],
      });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(body);
    });
    const { origin: rightOrigin } = await serve((_request, response) => {
      const body = manifestBody(rightOrigin, {
        name: "checkout-v2",
        exposes: [{ name: "./Cart" }, { name: "./MiniCart" }],
        shared: [
          { name: "react", version: "18.3.1" },
          { name: "react-dom", version: "18.3.1" },
        ],
        publicPath: `${rightOrigin}/cdn/`,
        remoteEntryPath: "../remoteEntry.v2.js",
      });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(body);
    });

    const result = await compareManifests([
      `${leftOrigin}/mf-manifest.json`,
      `${rightOrigin}/mf-manifest.json`,
    ]);
    expect(result.equal).toBe(false);
    expect(result.diffs.map((diff) => diff.field).sort()).toEqual([
      "exposes",
      "name",
      "publicPath",
      "remoteEntry",
      "shared",
    ]);
    await validatePayload("compare.schema.json", result, "compare diffs");
    const sarif = compareToSarif(result) as {
      runs: Array<{ results: unknown[] }>;
    };
    expect(sarif.runs[0]?.results).toHaveLength(5);
    expect(formatCompareTerminal(result)).toContain("[name]");
  });

  it("includes remoteEntry status when requested and never downloads the bundle body", async () => {
    const methods: string[] = [];
    const { origin } = await serve((request, response) => {
      methods.push(`${request.method} ${request.url}`);
      if (request.url?.endsWith("/remoteEntry.js")) {
        response.writeHead(200, { "content-type": "text/javascript", "content-length": "99" });
        response.end();
        return;
      }
      if (request.url?.endsWith("/remoteEntry.broken.js")) {
        response.writeHead(404);
        response.end();
        return;
      }
      if (request.url === "/left/mf-manifest.json") {
        response.end(manifestBody(origin, { remoteEntryPath: "../remoteEntry.js" }));
        return;
      }
      response.end(
        manifestBody(origin, {
          remoteEntryPath: "../remoteEntry.broken.js",
        }),
      );
    });

    const result = await compareManifests(
      [`${origin}/left/mf-manifest.json`, `${origin}/right/mf-manifest.json`],
      { remoteEntry: true },
    );
    expect(result.diffs.some((diff) => diff.field === "remoteEntryStatus")).toBe(true);
    expect(result.diffs.some((diff) => diff.field === "remoteEntry")).toBe(true);
    expect(methods).toEqual([
      "GET /left/mf-manifest.json",
      "HEAD /remoteEntry.js",
      "GET /right/mf-manifest.json",
      "HEAD /remoteEntry.broken.js",
    ]);
  });

  it("reuses probe safety for HTTP non-loopback and oversized payloads", async () => {
    await expect(
      compareManifests(["http://example.com/mf-manifest.json", "https://cdn.example.com/m.json"]),
    ).rejects.toThrow(/Only HTTPS URLs/);
    const { origin } = await serve((_request, response) => {
      response.writeHead(200, { "content-length": "100" });
      response.end("{}");
    });
    await expect(
      compareManifests([`${origin}/mf-manifest.json`], { maxBytes: 20 }),
    ).rejects.toBeInstanceOf(ProbeError);
  });

  it("rejects private-network redirect pivots via the shared probe policy", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      if (String(input) === "https://cdn.example.com/mf-manifest.json") {
        return new Response(null, {
          status: 302,
          headers: { location: "https://169.254.169.254/latest/meta-data/" },
        });
      }
      throw new Error(`unexpected fetch: ${String(input)}`);
    };
    await expect(
      compareManifests(["https://cdn.example.com/mf-manifest.json"], { fetch: fetchImpl }),
    ).rejects.toThrow(/private, link-local, metadata, or loopback/);
  });

  it("writes json and sarif reports", async () => {
    const { origin } = await serve((_request, response) => {
      response.end(manifestBody(origin));
    });
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-compare-"));
    roots.push(dir);
    const result = await compareManifests([`${origin}/mf-manifest.json`]);
    await writeCompareReports(result, dir, ["json", "sarif"]);
    const json = JSON.parse(await fs.readFile(path.join(dir, "compare.json"), "utf8"));
    const sarif = JSON.parse(await fs.readFile(path.join(dir, "compare.sarif"), "utf8"));
    expect(json.equal).toBe(true);
    expect(sarif.version).toBe("2.1.0");
    // Atomic writers leave no temp siblings beside the final report paths.
    const leftover = (await fs.readdir(dir)).filter((name) => name.includes(".mfdoctor-"));
    expect(leftover).toEqual([]);
  });
});

describe("compare CLI", () => {
  it("parses compare URLs and safety flags", () => {
    expect(
      parseArgs([
        "compare",
        "https://a.example/mf-manifest.json",
        "https://b.example/mf-manifest.json",
        "--timeout",
        "3000",
        "--max-bytes",
        "50000",
        "--remote-entry",
        "--format",
        "json,sarif",
      ]),
    ).toEqual({
      command: "compare",
      url: "https://a.example/mf-manifest.json",
      urls: ["https://a.example/mf-manifest.json", "https://b.example/mf-manifest.json"],
      patterns: [],
      roots: [],
      globs: [],
      workspace: false,
      ci: false,
      verbose: false,
      score: true,
      prompt: true,
      forcePrompt: false,
      stdoutJson: false,
      noWrite: false,
      timeoutMs: 3000,
      maxBytes: 50000,
      remoteEntry: true,
      formats: ["json", "sarif"],
    });
  });

  it("exits 0 on match, 1 on drift, and 2 on usage/fetch errors", async () => {
    const { origin } = await serve((request, response) => {
      if (request.url === "/drift/mf-manifest.json") {
        response.end(
          manifestBody(origin, {
            name: "other",
            exposes: [{ name: "./Other" }],
          }),
        );
        return;
      }
      response.end(manifestBody(origin));
    });

    await expect(
      main(["compare", `${origin}/a/mf-manifest.json`, `${origin}/b/mf-manifest.json`]),
    ).resolves.toBe(0);
    await expect(
      main(["compare", `${origin}/a/mf-manifest.json`, `${origin}/drift/mf-manifest.json`]),
    ).resolves.toBe(1);
    await expect(main(["compare"])).resolves.toBe(2);
    await expect(main(["compare", "http://example.com/mf-manifest.json"])).resolves.toBe(2);
  });
});
