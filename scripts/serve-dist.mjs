import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? "dist");
const basePort = Number(process.argv[3] ?? 4173);
const portOffset = Number(process.env.MFDOCTOR_E2E_PORT_OFFSET ?? 0);
const port = basePort + portOffset;
const types = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".map": "application/json",
  ".zip": "application/zip",
};

http
  .createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
    const candidate = path.resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
    if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    fs.stat(candidate, (statError, stat) => {
      const file =
        !statError && stat.isFile()
          ? candidate
          : pathname === "/" || !path.extname(pathname)
            ? path.join(root, "index.html")
            : undefined;
      if (!file) {
        response.writeHead(404).end("Not found");
        return;
      }
      fs.readFile(file, (readError, content) => {
        if (readError) {
          response.writeHead(404).end("Not found");
          return;
        }
        response.writeHead(200, {
          "access-control-allow-origin": "*",
          "content-type": types[path.extname(file)] ?? "application/octet-stream",
        });
        if (request.method === "HEAD") response.end();
        else response.end(content);
      });
    });
  })
  .listen(port, "127.0.0.1", () => {
    process.stdout.write(`Serving ${root} on http://127.0.0.1:${port}\n`);
  });
