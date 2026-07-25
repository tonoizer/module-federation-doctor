import fs from "node:fs";
import http from "node:http";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const DEFAULT_UI_PORT = 51205;

const types: Record<string, string> = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export interface ServeUiOptions {
  directory: string;
  port?: number;
  open?: boolean;
  entry?: string;
}

export interface ServeUiHandle {
  url: string;
  port: number;
  close: () => Promise<void>;
  closed: Promise<void>;
}

function loopbackHttpUrl(port: number): string {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid UI server port: ${String(port)}`);
  }
  return `http://127.0.0.1:${port}/`;
}

function openBrowser(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1") return;
  let safeUrl: string;
  try {
    safeUrl = loopbackHttpUrl(Number(parsed.port));
  } catch {
    return;
  }

  const platform = process.platform;
  if (platform === "darwin") void execFileAsync("open", [safeUrl]).catch(() => undefined);
  else if (platform === "win32")
    void execFileAsync("rundll32", ["url.dll,FileProtocolHandler", safeUrl]).catch(() => undefined);
  else void execFileAsync("xdg-open", [safeUrl]).catch(() => undefined);
}

export function serveUi(options: ServeUiOptions): Promise<ServeUiHandle> {
  const root = path.resolve(options.directory);
  const port = options.port ?? DEFAULT_UI_PORT;
  if (port !== 0 && (!Number.isInteger(port) || port < 1 || port > 65535)) {
    return Promise.reject(new Error(`Invalid UI server port: ${String(port)}`));
  }
  const entry = options.entry ?? "report.html";
  const host = "127.0.0.1";

  return new Promise((resolve, reject) => {
    let settleClosed: () => void = () => undefined;
    const closed = new Promise<void>((settle) => {
      settleClosed = settle;
    });

    const server = http.createServer((request, response) => {
      const pathname = decodeURIComponent(new URL(request.url ?? "/", `http://${host}`).pathname);
      const relative = pathname === "/" ? `/${entry}` : pathname;
      const candidate = path.resolve(root, `.${relative}`);
      if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
        response.writeHead(403).end("Forbidden");
        return;
      }
      fs.stat(candidate, (statError, stat) => {
        const file = !statError && stat.isFile() ? candidate : path.join(root, entry);
        fs.readFile(file, (readError, content) => {
          if (readError) {
            response.writeHead(404).end("Not found");
            return;
          }
          response.writeHead(200, {
            "content-type": types[path.extname(file)] ?? "application/octet-stream",
            "cache-control": "no-store",
          });
          if (request.method === "HEAD") response.end();
          else response.end(content);
        });
      });
    });

    server.once("error", reject);
    server.listen(port, host, () => {
      const address = server.address();
      const boundPort = address && typeof address === "object" ? address.port : port;
      let url: string;
      try {
        url = loopbackHttpUrl(boundPort);
      } catch (error) {
        server.close();
        reject(error);
        return;
      }
      process.stdout.write(`Module Federation Doctor UI: ${url}\n`);
      if (options.open !== false) openBrowser(url);
      resolve({
        url,
        port: boundPort,
        closed,
        close: () =>
          new Promise((settle, fail) => {
            server.close((error) => {
              settleClosed();
              if (error) fail(error);
              else settle();
            });
          }),
      });
    });

    const stop = () => {
      server.close(() => settleClosed());
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

export async function serveUiUntilClosed(options: ServeUiOptions): Promise<string> {
  const handle = await serveUi(options);
  await handle.closed;
  return handle.url;
}
