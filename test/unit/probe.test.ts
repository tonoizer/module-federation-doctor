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

  it("rejects redirect chains that land on private or metadata hosts", async () => {
    const requests: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const href = String(input);
      requests.push(href);
      if (href === "https://cdn.example.com/mf-manifest.json") {
        return new Response(null, {
          status: 302,
          headers: { location: "https://safe.example.com/step" },
        });
      }
      if (href === "https://safe.example.com/step") {
        return new Response(null, {
          status: 302,
          headers: { location: "https://169.254.169.254/latest/meta-data/" },
        });
      }
      throw new Error(`unexpected fetch: ${href}`);
    };

    await expect(
      probeManifest("https://cdn.example.com/mf-manifest.json", { fetch: fetchImpl }),
    ).rejects.toThrow(/private, link-local, metadata, or loopback/);
    expect(requests).toEqual([
      "https://cdn.example.com/mf-manifest.json",
      "https://safe.example.com/step",
    ]);
  });

  it("rejects redirects to cloud metadata hostnames", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      if (String(input) === "https://cdn.example.com/mf-manifest.json") {
        return new Response(null, {
          status: 301,
          headers: { location: "https://metadata.google.internal/computeMetadata/v1/" },
        });
      }
      throw new Error(`unexpected fetch: ${String(input)}`);
    };

    await expect(
      probeManifest("https://cdn.example.com/mf-manifest.json", { fetch: fetchImpl }),
    ).rejects.toThrow(/private, link-local, metadata, or loopback/);
  });

  it("rejects redirects to metadata hostnames with a trailing DNS dot", async () => {
    const requests: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const href = String(input);
      requests.push(href);
      if (href === "https://cdn.example.com/mf-manifest.json") {
        return new Response(null, {
          status: 301,
          headers: { location: "https://metadata.google.internal./computeMetadata/v1/" },
        });
      }
      throw new Error(`unexpected fetch: ${href}`);
    };

    await expect(
      probeManifest("https://cdn.example.com/mf-manifest.json", { fetch: fetchImpl }),
    ).rejects.toThrow(/private, link-local, metadata, or loopback/);
    expect(requests).toEqual(["https://cdn.example.com/mf-manifest.json"]);
  });

  it("rejects redirects to IPv4-mapped IPv6 link-local / metadata addresses", async () => {
    const requests: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const href = String(input);
      requests.push(href);
      if (href === "https://cdn.example.com/mf-manifest.json") {
        return new Response(null, {
          status: 302,
          // Node normalizes this Location host to [::ffff:a9fe:a9fe]
          headers: { location: "https://[::ffff:169.254.169.254]/" },
        });
      }
      throw new Error(`unexpected fetch: ${href}`);
    };

    await expect(
      probeManifest("https://cdn.example.com/mf-manifest.json", { fetch: fetchImpl }),
    ).rejects.toThrow(/private, link-local, metadata, or loopback/);
    expect(requests).toEqual(["https://cdn.example.com/mf-manifest.json"]);
  });

  it("rejects public HTTPS redirects to HTTP loopback without allowPrivateNetworks", async () => {
    for (const target of [
      "http://127.0.0.1:8080/mf-manifest.json",
      "http://localhost/mf-manifest.json",
      "http://[::1]/mf-manifest.json",
    ]) {
      const requests: string[] = [];
      const fetchImpl: typeof fetch = async (input) => {
        const href = String(input);
        requests.push(href);
        if (href === "https://cdn.example.com/mf-manifest.json") {
          return new Response(null, {
            status: 302,
            headers: { location: target },
          });
        }
        throw new Error(`unexpected fetch: ${href}`);
      };

      await expect(
        probeManifest("https://cdn.example.com/mf-manifest.json", { fetch: fetchImpl }),
      ).rejects.toThrow(/private, link-local, metadata, or loopback/);
      expect(requests).toEqual(["https://cdn.example.com/mf-manifest.json"]);
    }
  });

  it("allows private redirect targets only when explicitly opted in", async () => {
    const body = JSON.stringify({
      id: "checkout",
      name: "checkout",
      exposes: [],
      shared: [],
      remotes: [],
    });
    const fetchImpl: typeof fetch = async (input) => {
      const href = String(input);
      if (href === "https://cdn.example.com/mf-manifest.json") {
        return new Response(null, {
          status: 302,
          headers: { location: "https://10.0.0.8/mf-manifest.json" },
        });
      }
      if (href === "https://10.0.0.8/mf-manifest.json") {
        return new Response(body, {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch: ${href}`);
    };

    await expect(
      probeManifest("https://cdn.example.com/mf-manifest.json", { fetch: fetchImpl }),
    ).rejects.toThrow(/private, link-local, metadata, or loopback/);

    const result = await probeManifest("https://cdn.example.com/mf-manifest.json", {
      fetch: fetchImpl,
      allowPrivateNetworks: true,
    });
    expect(result.manifest).toMatchObject({
      url: "https://10.0.0.8/mf-manifest.json",
      status: 200,
      name: "checkout",
    });
  });

  it("allows HTTP loopback redirect targets only when explicitly opted in", async () => {
    const body = JSON.stringify({
      id: "checkout",
      name: "checkout",
      exposes: [],
      shared: [],
      remotes: [],
    });
    const fetchImpl: typeof fetch = async (input) => {
      const href = String(input);
      if (href === "https://cdn.example.com/mf-manifest.json") {
        return new Response(null, {
          status: 302,
          headers: { location: "http://127.0.0.1:9/mf-manifest.json" },
        });
      }
      if (href === "http://127.0.0.1:9/mf-manifest.json") {
        return new Response(body, {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch: ${href}`);
    };

    await expect(
      probeManifest("https://cdn.example.com/mf-manifest.json", { fetch: fetchImpl }),
    ).rejects.toThrow(/private, link-local, metadata, or loopback/);

    const result = await probeManifest("https://cdn.example.com/mf-manifest.json", {
      fetch: fetchImpl,
      allowPrivateNetworks: true,
    });
    expect(result.manifest).toMatchObject({
      url: "http://127.0.0.1:9/mf-manifest.json",
      status: 200,
      name: "checkout",
    });
  });

  it("follows a safe HTTPS redirect chain within the hop limit", async () => {
    const body = JSON.stringify({
      id: "checkout",
      name: "checkout",
      exposes: [{ name: "./Cart" }],
      shared: [],
      remotes: [],
    });
    const fetchImpl: typeof fetch = async (input) => {
      const href = String(input);
      if (href === "https://cdn.example.com/mf-manifest.json") {
        return new Response(null, {
          status: 302,
          headers: { location: "/v2/mf-manifest.json" },
        });
      }
      if (href === "https://cdn.example.com/v2/mf-manifest.json") {
        return new Response(body, {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch: ${href}`);
    };

    const result = await probeManifest("https://cdn.example.com/mf-manifest.json", {
      fetch: fetchImpl,
    });
    expect(result.manifest).toMatchObject({
      url: "https://cdn.example.com/v2/mf-manifest.json",
      status: 200,
      name: "checkout",
      exposes: 1,
    });
  });
});
