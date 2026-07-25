import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { serveUi } from "../../src/ui-server.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("UI server", () => {
  it("serves report.html on loopback only", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mfdoctor-ui-server-"));
    roots.push(root);
    await fs.writeFile(path.join(root, "report.html"), "<html>doctor-ui</html>");
    const handle = await serveUi({ directory: root, port: 0, open: false });
    try {
      const address = await new Promise<string>((resolve, reject) => {
        http
          .get(handle.url, (response) => {
            const chunks: Buffer[] = [];
            response.on("data", (chunk) => chunks.push(chunk));
            response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
          })
          .on("error", reject);
      });
      expect(address).toContain("doctor-ui");
      expect(handle.url.startsWith("http://127.0.0.1:")).toBe(true);
    } finally {
      await handle.close();
    }
  });
});
