import { BlockList, isIP } from "node:net";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const METADATA_HOSTNAMES = new Set(["metadata.google.internal", "metadata.goog"]);

/** Private, link-local, loopback, CGNAT, and ULA ranges (incl. IPv4-mapped IPv6). */
const RESTRICTED_NETWORKS = new BlockList();
RESTRICTED_NETWORKS.addSubnet("0.0.0.0", 8, "ipv4");
RESTRICTED_NETWORKS.addSubnet("10.0.0.0", 8, "ipv4");
RESTRICTED_NETWORKS.addSubnet("100.64.0.0", 10, "ipv4");
RESTRICTED_NETWORKS.addSubnet("127.0.0.0", 8, "ipv4");
RESTRICTED_NETWORKS.addSubnet("169.254.0.0", 16, "ipv4");
RESTRICTED_NETWORKS.addSubnet("172.16.0.0", 12, "ipv4");
RESTRICTED_NETWORKS.addSubnet("192.168.0.0", 16, "ipv4");
RESTRICTED_NETWORKS.addSubnet("::1", 128, "ipv6");
RESTRICTED_NETWORKS.addSubnet("fe80::", 10, "ipv6");
RESTRICTED_NETWORKS.addSubnet("fc00::", 7, "ipv6");

export interface ProbeOptions {
  timeoutMs?: number;
  maxBytes?: number;
  remoteEntry?: boolean;
  /** Allow private, link-local, metadata, and loopback targets (off by default). */
  allowPrivateNetworks?: boolean;
  fetch?: typeof globalThis.fetch;
}

interface ProbeUrlOptions {
  allowPrivateNetworks?: boolean;
  /**
   * Allow plain HTTP to loopback hosts. Only set for the user-supplied initial
   * URL (local probe DX). Redirect hops must not set this — public →
   * `http://127.0.0.1` requires `allowPrivateNetworks`.
   */
  allowLoopbackHttp?: boolean;
}

export interface ManifestProbeResult {
  schemaVersion: 1;
  manifest: {
    url: string;
    status: number;
    bytes: number;
    name?: string;
    id?: string;
    publicPath?: string;
    remoteEntry?: string;
    exposes: number;
    shared: number;
    remotes: number;
  };
  remoteEntry?: {
    url: string;
    status: number;
    contentType?: string;
    contentLength?: number;
  };
}

export class ProbeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProbeError";
  }
}

function unbracketHostname(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

/** Normalize host for policy checks (FQDN trailing dots + brackets). */
function normalizeHostname(hostname: string): string {
  return unbracketHostname(hostname.toLowerCase().replace(/\.+$/, ""));
}

function isRestrictedNetworkHost(hostname: string): boolean {
  const host = normalizeHostname(hostname);
  if (METADATA_HOSTNAMES.has(host) || host === "localhost") return true;
  const version = isIP(host);
  if (version === 4) return RESTRICTED_NETWORKS.check(host, "ipv4");
  if (version === 6) return RESTRICTED_NETWORKS.check(host, "ipv6");
  return false;
}

function assertProbeUrlAllowed(url: URL, options: ProbeUrlOptions): void {
  if (url.username || url.password)
    throw new ProbeError("URLs with embedded credentials are not allowed.");
  const isHttpLoopback = url.protocol === "http:" && isLoopback(url.hostname);
  // Plain HTTP is only syntactically valid for loopback; network policy below
  // still applies unless allowLoopbackHttp (initial URL) or allowPrivateNetworks.
  if (url.protocol !== "https:" && !isHttpLoopback)
    throw new ProbeError("Only HTTPS URLs are allowed. HTTP is allowed only for localhost.");
  if (options.allowPrivateNetworks) return;
  if (isHttpLoopback && options.allowLoopbackHttp) return;
  if (isRestrictedNetworkHost(url.hostname))
    throw new ProbeError(
      "URLs targeting private, link-local, metadata, or loopback networks are not allowed.",
    );
}

function safeUrl(value: string, options: ProbeUrlOptions = {}): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ProbeError(`Invalid URL: ${value}`);
  }
  assertProbeUrlAllowed(url, options);
  return url;
}

function isLoopback(hostname: string): boolean {
  const host = normalizeHostname(hostname);
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function publicUrl(url: URL): string {
  const copy = new URL(url);
  copy.username = "";
  copy.password = "";
  copy.search = "";
  copy.hash = "";
  return copy.href;
}

async function guardedFetch(
  initialUrl: URL,
  init: RequestInit,
  fetcher: typeof globalThis.fetch,
  urlOptions: ProbeUrlOptions = {},
): Promise<{ response: Response; url: URL }> {
  let url = initialUrl;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const response = await fetcher(url, { ...init, redirect: "manual" });
    if (response.status < 300 || response.status >= 400) return { response, url };
    const location = response.headers.get("location");
    if (!location) throw new ProbeError(`Redirect from ${publicUrl(url)} has no Location header.`);
    if (redirects === MAX_REDIRECTS) throw new ProbeError("Too many redirects.");
    url = safeUrl(new URL(location, url).href, urlOptions);
  }
  throw new ProbeError("Too many redirects.");
}

async function readBounded(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes)
    throw new ProbeError(`Response is larger than ${maxBytes} bytes.`);
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new ProbeError(`Response is larger than ${maxBytes} bytes.`);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function manifestSummary(value: unknown, manifestUrl: URL) {
  const root = record(value);
  if (!root) throw new ProbeError("Manifest must be a JSON object.");
  const meta = record(root.metaData) ?? record(root.metadata);
  const name = string(root.name) ?? string(meta?.name);
  const id = string(root.id) ?? string(meta?.id);
  if (!name && !id) throw new ProbeError("Manifest has no federation name or id.");

  const publicPath = string(root.publicPath) ?? string(meta?.publicPath);
  const remote = record(root.remoteEntry) ?? record(meta?.remoteEntry);
  const remotePath = string(remote?.path) ?? string(remote?.name);
  let remoteEntry: string | undefined;
  if (remotePath) {
    try {
      remoteEntry = new URL(remotePath, publicPath ? new URL(publicPath, manifestUrl) : manifestUrl)
        .href;
    } catch {
      throw new ProbeError("Manifest remote entry URL is invalid.");
    }
  }
  return {
    name,
    id,
    publicPath,
    remoteEntry,
    exposes: arrayLength(root.exposes),
    shared: arrayLength(root.shared),
    remotes: arrayLength(root.remotes),
  };
}

export async function probeManifest(
  value: string,
  options: ProbeOptions = {},
): Promise<ManifestProbeResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000)
    throw new ProbeError("timeoutMs must be an integer from 1 to 120000.");
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 20 * 1024 * 1024)
    throw new ProbeError("maxBytes must be an integer from 1 to 20971520.");

  const fetcher = options.fetch ?? globalThis.fetch;
  const urlOptions: ProbeUrlOptions =
    options.allowPrivateNetworks === undefined
      ? {}
      : { allowPrivateNetworks: options.allowPrivateNetworks };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // HTTP loopback exception is for the user-supplied URL only; redirects use urlOptions.
    const initial = safeUrl(value, { ...urlOptions, allowLoopbackHttp: true });
    const { response, url } = await guardedFetch(
      initial,
      { headers: { accept: "application/json" }, signal: controller.signal },
      fetcher,
      urlOptions,
    );
    if (!response.ok) throw new ProbeError(`Manifest request failed with HTTP ${response.status}.`);
    const bytes = await readBounded(response, maxBytes);
    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new ProbeError("Manifest response is not valid JSON.");
    }
    const summary = manifestSummary(body, url);
    const result: ManifestProbeResult = {
      schemaVersion: 1,
      manifest: {
        url: publicUrl(url),
        status: response.status,
        bytes: bytes.byteLength,
        exposes: summary.exposes,
        shared: summary.shared,
        remotes: summary.remotes,
        ...(summary.name ? { name: summary.name } : {}),
        ...(summary.id ? { id: summary.id } : {}),
        ...(summary.publicPath ? { publicPath: publicUrl(new URL(summary.publicPath, url)) } : {}),
        ...(summary.remoteEntry
          ? { remoteEntry: publicUrl(new URL(summary.remoteEntry, url)) }
          : {}),
      },
    };

    if (options.remoteEntry && summary.remoteEntry) {
      // Keep local DX when the user started on HTTP loopback; do not open a
      // public-manifest → http://127.0.0.1 remote-entry pivot without opt-in.
      const remoteUrl = safeUrl(summary.remoteEntry, {
        ...urlOptions,
        allowLoopbackHttp: initial.protocol === "http:" && isLoopback(initial.hostname),
      });
      const remote = await guardedFetch(
        remoteUrl,
        { method: "HEAD", signal: controller.signal },
        fetcher,
        urlOptions,
      );
      result.remoteEntry = {
        url: publicUrl(remote.url),
        status: remote.response.status,
        ...(remote.response.headers.get("content-type")
          ? { contentType: remote.response.headers.get("content-type")! }
          : {}),
        ...(numberHeader(remote.response.headers.get("content-length")) === undefined
          ? {}
          : { contentLength: numberHeader(remote.response.headers.get("content-length"))! }),
      };
    }
    return result;
  } catch (error) {
    if (error instanceof ProbeError) throw error;
    if (error instanceof Error && error.name === "AbortError")
      throw new ProbeError(`Probe timed out after ${timeoutMs}ms.`);
    throw new ProbeError(error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timeout);
  }
}

function numberHeader(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}
