import { createServer, type RequestListener, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { ProbeError, probeManifest } from "../../src/probe.js";

const servers: Server[] = [];

afterEach(async () => {
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

async function serve(handler: RequestListener): Promise<{ server: Server; origin: string }> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test server address.");
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

describe("manifest probe", () => {
  it("reads a bounded manifest and checks its remote entry without executing it", async () => {
    const methods: string[] = [];
    const { origin } = await serve((request, response) => {
      methods.push(`${request.method} ${request.url}`);
      if (request.url === "/remoteEntry.js") {
        response.writeHead(200, { "content-type": "text/javascript", "content-length": "42" });
        response.end();
        return;
      }
      const body = JSON.stringify({
        id: "checkout",
        name: "checkout",
        metaData: {
          publicPath: `${origin}/assets/`,
          remoteEntry: { path: "../remoteEntry.js", name: "remoteEntry.js" },
        },
        exposes: [{ name: "./Cart" }],
        shared: [{ name: "react" }],
        remotes: [],
      });
      response.writeHead(200, {
        "content-type": "application/json",
        "content-length": body.length,
      });
      response.end(body);
    });

    const result = await probeManifest(`${origin}/mf-manifest.json?token=secret`, {
      remoteEntry: true,
    });

    expect(result.manifest).toMatchObject({
      url: `${origin}/mf-manifest.json`,
      status: 200,
      name: "checkout",
      exposes: 1,
      shared: 1,
      remoteEntry: `${origin}/remoteEntry.js`,
    });
    expect(result.remoteEntry).toMatchObject({
      url: `${origin}/remoteEntry.js`,
      status: 200,
      contentType: "text/javascript",
      contentLength: 42,
    });
    expect(methods).toEqual(["GET /mf-manifest.json?token=secret", "HEAD /remoteEntry.js"]);
  });

  it("rejects unsafe URLs and oversized responses", async () => {
    await expect(probeManifest("http://example.com/mf-manifest.json")).rejects.toThrow(
      "Only HTTPS URLs",
    );
    const { origin } = await serve((_request, response) => {
      response.writeHead(200, { "content-length": "100" });
      response.end("{}");
    });
    await expect(probeManifest(`${origin}/manifest.json`, { maxBytes: 20 })).rejects.toThrow(
      "larger than 20 bytes",
    );
  });

  it("rejects malformed federation manifests", async () => {
    const { origin } = await serve((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}");
    });
    await expect(probeManifest(`${origin}/manifest.json`)).rejects.toBeInstanceOf(ProbeError);
  });
});
