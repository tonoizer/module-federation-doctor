import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";

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
  /** Override the transport for tests or callers that provide their own policy. */
  fetch?: typeof globalThis.fetch;
}

interface ProbeUrlOptions {
  allowPrivateNetworks?: boolean;
  /**
   * Allow plain HTTP to loopback hosts. Only set for the user-supplied initial
   * URL (local probe DX). Redirect hops must not set this, public →
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

export interface ManifestContractShared {
  name: string;
  version?: string;
}

/** Richer manifest snapshot used by compare; still fetched via probe safety. */
export interface ManifestContract {
  url: string;
  status: number;
  bytes: number;
  name?: string;
  id?: string;
  publicPath?: string;
  remoteEntry?: string;
  /** Unique expose keys (path/key/name), sorted. */
  exposes: string[];
  /** Unique shared packages, sorted by name. */
  shared: ManifestContractShared[];
  /** Raw remotes array length from the manifest. */
  remotes: number;
  /** Raw exposes / shared array lengths (probe summary counts). */
  exposeCount: number;
  sharedCount: number;
  remoteEntryProbe?: {
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

interface ProbeAddress {
  address: string;
  family: 4 | 6;
}

function restrictedAddress(address: ProbeAddress): boolean {
  const host = normalizeHostname(address.address);
  const version = isIP(host);
  if (version === 4) return RESTRICTED_NETWORKS.check(host, "ipv4");
  if (version === 6) return RESTRICTED_NETWORKS.check(host, "ipv6");
  return false;
}

async function resolveProbeAddresses(hostname: string): Promise<ProbeAddress[]> {
  const host = normalizeHostname(hostname);
  const version = isIP(host);
  if (version === 4 || version === 6) return [{ address: host, family: version }];

  try {
    const addresses = await dns.lookup(host, { all: true, verbatim: true });
    return addresses.map(({ address, family }) => ({
      address,
      family: family === 6 ? 6 : 4,
    }));
  } catch {
    throw new ProbeError(`Unable to resolve probe host: ${host}`);
  }
}

function assertResolvedProbeAddresses(
  url: URL,
  addresses: ProbeAddress[],
  options: ProbeUrlOptions,
): void {
  if (addresses.length === 0) throw new ProbeError(`Unable to resolve probe host: ${url.hostname}`);
  if (options.allowPrivateNetworks) return;
  if (url.protocol === "http:" && options.allowLoopbackHttp && isLoopback(url.hostname)) return;
  if (addresses.some(restrictedAddress))
    throw new ProbeError(
      "URLs targeting private, link-local, metadata, or loopback networks are not allowed.",
    );
}

function responseHeaders(response: http.IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(response.headers)) {
    if (value === undefined) continue;
    headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  return headers;
}

function abortError(): Error {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

/**
 * Fetch through a socket whose address was resolved and checked by this call.
 * Passing the selected address through Node's lookup hook avoids a second DNS
 * lookup between the policy check and the connection.
 */
async function pinnedFetch(
  url: URL,
  init: RequestInit,
  urlOptions: ProbeUrlOptions,
): Promise<Response> {
  const addresses = await resolveProbeAddresses(url.hostname);
  assertResolvedProbeAddresses(url, addresses, urlOptions);
  if (init.body !== undefined && init.body !== null)
    throw new ProbeError("Probe requests do not support request bodies.");

  const selected = addresses[0]!;
  const method = init.method ?? "GET";
  const headers: Record<string, string> = {};
  new Headers(init.headers).forEach((value, name) => {
    headers[name] = value;
  });
  const hostname = unbracketHostname(url.hostname);
  const requestOptions = {
    protocol: url.protocol,
    hostname,
    ...(url.port ? { port: url.port } : {}),
    path: `${url.pathname}${url.search}`,
    method,
    headers,
    lookup: ((
      _hostname: string,
      _options: Parameters<LookupFunction>[1],
      callback: Parameters<LookupFunction>[2],
    ) => callback(null, selected.address, selected.family)) as LookupFunction,
    ...(url.protocol === "https:" && isIP(hostname) === 0 ? { servername: hostname } : {}),
  };

  return await new Promise<Response>((resolve, reject) => {
    let request: http.ClientRequest;
    let settled = false;
    const signal = init.signal ?? undefined;
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onAbort = () => request.destroy(abortError());
    const onResponse = (response: http.IncomingMessage) => {
      if (settled) return;
      settled = true;
      cleanup();
      const status = response.statusCode ?? 0;
      const bodyless = method.toUpperCase() === "HEAD" || [204, 205, 304].includes(status);
      try {
        const body = bodyless ? null : (Readable.toWeb(response) as ReadableStream<Uint8Array>);
        if (bodyless) response.resume();
        const responseInit: ResponseInit = { status, headers: responseHeaders(response) };
        if (response.statusMessage) responseInit.statusText = response.statusMessage;
        resolve(new Response(body, responseInit));
      } catch (error) {
        response.resume();
        reject(error);
      }
    };

    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    try {
      request =
        url.protocol === "https:"
          ? https.request(requestOptions, onResponse)
          : http.request(requestOptions, onResponse);
      request.once("error", fail);
      signal?.addEventListener("abort", onAbort, { once: true });
      request.end();
    } catch (error) {
      fail(error);
    }
  });
}

function createPinnedFetcher(urlOptions: ProbeUrlOptions): typeof globalThis.fetch {
  return (input, init) => {
    const url =
      input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url);
    return pinnedFetch(url, init ?? {}, urlOptions);
  };
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
    await response.body?.cancel().catch(() => undefined);
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

function exposeKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const keys = new Set<string>();
  for (const item of value) {
    const entry = record(item);
    const key = string(entry?.path) ?? string(entry?.key) ?? string(entry?.name);
    if (key) keys.add(key);
  }
  return [...keys].sort();
}

function sharedEntries(value: unknown): ManifestContractShared[] {
  if (!Array.isArray(value)) return [];
  const byName = new Map<string, ManifestContractShared>();
  for (const item of value) {
    const entry =
      item && typeof item === "object"
        ? (item as Record<string, unknown>)
        : typeof item === "string"
          ? { name: item }
          : undefined;
    const name = string(entry?.name);
    if (!name) continue;
    const shared: ManifestContractShared = { name };
    const version = string(entry?.version);
    if (version) shared.version = version;
    byName.set(name, shared);
  }
  return [...byName.values()].sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  );
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
    exposeKeys: exposeKeys(root.exposes),
    sharedEntries: sharedEntries(root.shared),
    exposes: arrayLength(root.exposes),
    shared: arrayLength(root.shared),
    remotes: arrayLength(root.remotes),
  };
}

/**
 * Load a deployed MF manifest through the same SSRF / HTTPS / size / redirect
 * guards as {@link probeManifest}, returning expose and shared detail for compare.
 * Does not download or execute remote JavaScript; `--remote-entry` only HEADs.
 */
export async function loadManifestContract(
  value: string,
  options: ProbeOptions = {},
): Promise<ManifestContract> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000)
    throw new ProbeError("timeoutMs must be an integer from 1 to 120000.");
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 20 * 1024 * 1024)
    throw new ProbeError("maxBytes must be an integer from 1 to 20971520.");

  const urlOptions: ProbeUrlOptions =
    options.allowPrivateNetworks === undefined
      ? {}
      : { allowPrivateNetworks: options.allowPrivateNetworks };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // HTTP loopback exception is for the user-supplied URL only; redirects use urlOptions.
    const initial = safeUrl(value, { ...urlOptions, allowLoopbackHttp: true });
    const fetcher =
      options.fetch ??
      createPinnedFetcher({
        ...urlOptions,
        allowLoopbackHttp: initial.protocol === "http:" && isLoopback(initial.hostname),
      });
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
    const contract: ManifestContract = {
      url: publicUrl(url),
      status: response.status,
      bytes: bytes.byteLength,
      exposes: summary.exposeKeys,
      shared: summary.sharedEntries,
      remotes: summary.remotes,
      exposeCount: summary.exposes,
      sharedCount: summary.shared,
      ...(summary.name ? { name: summary.name } : {}),
      ...(summary.id ? { id: summary.id } : {}),
      ...(summary.publicPath ? { publicPath: publicUrl(new URL(summary.publicPath, url)) } : {}),
      ...(summary.remoteEntry ? { remoteEntry: publicUrl(new URL(summary.remoteEntry, url)) } : {}),
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
      contract.remoteEntryProbe = {
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
    return contract;
  } catch (error) {
    if (error instanceof ProbeError) throw error;
    if (error instanceof Error && error.name === "AbortError")
      throw new ProbeError(`Probe timed out after ${timeoutMs}ms.`);
    throw new ProbeError(error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timeout);
  }
}

export async function probeManifest(
  value: string,
  options: ProbeOptions = {},
): Promise<ManifestProbeResult> {
  const contract = await loadManifestContract(value, options);
  const result: ManifestProbeResult = {
    schemaVersion: 1,
    manifest: {
      url: contract.url,
      status: contract.status,
      bytes: contract.bytes,
      exposes: contract.exposeCount,
      shared: contract.sharedCount,
      remotes: contract.remotes,
      ...(contract.name ? { name: contract.name } : {}),
      ...(contract.id ? { id: contract.id } : {}),
      ...(contract.publicPath ? { publicPath: contract.publicPath } : {}),
      ...(contract.remoteEntry ? { remoteEntry: contract.remoteEntry } : {}),
    },
  };
  if (contract.remoteEntryProbe) result.remoteEntry = contract.remoteEntryProbe;
  return result;
}

function numberHeader(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}
