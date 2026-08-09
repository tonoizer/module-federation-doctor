import { createHash } from "node:crypto";
import type { ResolvedDoctorOptions } from "./types.js";

export interface AnalysisCacheOptions {
  /** Maximum number of successfully parsed entries retained in this process. */
  maxEntries?: number;
  /** Maximum approximate UTF-8 bytes retained in this process. */
  maxBytes?: number;
}

export interface AnalysisCacheStats {
  hits: number;
  misses: number;
  entries: number;
  bytes: number;
  maxEntries: number;
  maxBytes: number;
}

export const DEFAULT_ANALYSIS_CACHE_OPTIONS: Required<AnalysisCacheOptions> = Object.freeze({
  maxEntries: 256,
  maxBytes: 16 * 1024 * 1024,
});

/** Bump when the cached projection shape or its interpretation changes. */
export const ANALYSIS_CACHE_SCHEMA_VERSION = 1;
/** Bump when source/artifact collection semantics change. */
export const ANALYSIS_COLLECTOR_REVISION = "source-artifact-collector-v3";

function assertBound(name: string, value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new TypeError(`${name} must be a non-negative safe integer.`);
}

function stableValue(value: unknown, active: WeakSet<object>): unknown {
  if (value === null || typeof value !== "object") return value;
  if (active.has(value)) return "[cycle]";
  active.add(value);
  if (Array.isArray(value)) {
    const result = value.map((item) => stableValue(item, active));
    active.delete(value);
    return result;
  }
  const result: Record<string, unknown> = {};
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record).sort()) result[key] = stableValue(record[key], active);
  active.delete(value);
  return result;
}

type JsonCacheValue =
  | null
  | boolean
  | number
  | string
  | JsonCacheValue[]
  | { [key: string]: JsonCacheValue };

function cloneJsonCacheValue(
  value: unknown,
  active: WeakSet<object> = new WeakSet<object>(),
): JsonCacheValue | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "object") return undefined;
  if (active.has(value)) return undefined;
  active.add(value);
  if (Array.isArray(value)) {
    const result: JsonCacheValue[] = [];
    for (const item of value) {
      const cloned = cloneJsonCacheValue(item, active);
      if (cloned === undefined) {
        active.delete(value);
        return undefined;
      }
      result.push(cloned);
    }
    active.delete(value);
    return result;
  }
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    active.delete(value);
    return undefined;
  }
  const result: { [key: string]: JsonCacheValue } = {};
  for (const key of Object.keys(value)) {
    const cloned = cloneJsonCacheValue((value as Record<string, unknown>)[key], active);
    if (cloned === undefined) {
      active.delete(value);
      return undefined;
    }
    result[key] = cloned;
  }
  active.delete(value);
  return result;
}

/** Stable, non-secret identity material for adapter/config-sensitive cache keys. */
export function stableSerialize(value: unknown): string {
  return JSON.stringify(stableValue(value, new WeakSet<object>())) ?? "null";
}

export function contentDigest(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

export function createAnalysisCacheIdentity(
  options: Pick<
    ResolvedDoctorOptions,
    | "bundler"
    | "bundlerVersion"
    | "mode"
    | "moduleFederation"
    | "moduleFederationInstances"
    | "sharedPolicy"
    | "viteLifecycle"
    | "viteConfigFacts"
    | "transformImportLibraries"
    | "recognizeMfToolkit"
    | "artifactNames"
    | "include"
    | "exclude"
  >,
): string {
  return stableSerialize({
    cacheSchemaVersion: ANALYSIS_CACHE_SCHEMA_VERSION,
    collectorRevision: ANALYSIS_COLLECTOR_REVISION,
    adapter: options.bundler,
    version: options.bundlerVersion ?? "unknown",
    mode: options.mode,
    moduleFederation: options.moduleFederation ?? null,
    moduleFederationInstances: options.moduleFederationInstances ?? null,
    sharedPolicy: options.sharedPolicy,
    viteLifecycle: options.viteLifecycle ?? null,
    viteConfigFacts: options.viteConfigFacts ?? null,
    transformImportLibraries: options.transformImportLibraries ?? null,
    recognizeMfToolkit: options.recognizeMfToolkit ?? null,
    artifactNames: options.artifactNames,
    include: options.include,
    exclude: options.exclude,
  });
}

export function analysisCacheKey(
  kind: "source" | "artifact",
  relativePath: string,
  digest: string,
  identity: string,
): string {
  return `${kind}\0${relativePath}\0${digest}\0${identity}`;
}

interface CacheEntry {
  value: unknown;
  bytes: number;
}

/** A bounded LRU cache intended to be explicitly shared within one process. */
export class AnalysisContentCache {
  readonly maxEntries: number;
  readonly maxBytes: number;
  private readonly entries = new Map<string, CacheEntry>();
  private totalBytes = 0;
  private hitCount = 0;
  private missCount = 0;

  constructor(options: AnalysisCacheOptions = {}) {
    const maxEntries = options.maxEntries ?? DEFAULT_ANALYSIS_CACHE_OPTIONS.maxEntries;
    const maxBytes = options.maxBytes ?? DEFAULT_ANALYSIS_CACHE_OPTIONS.maxBytes;
    assertBound("maxEntries", maxEntries);
    assertBound("maxBytes", maxBytes);
    this.maxEntries = maxEntries;
    this.maxBytes = maxBytes;
  }

  get<T>(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      this.missCount += 1;
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.hitCount += 1;
    const value = cloneJsonCacheValue(entry.value);
    if (value === undefined) {
      this.entries.delete(key);
      this.totalBytes -= entry.bytes;
      return undefined;
    }
    return value as T;
  }

  set<T>(key: string, value: T, bytes: number): boolean {
    assertBound("cache entry bytes", bytes);
    if (this.maxEntries === 0 || bytes > this.maxBytes) return false;
    const cloned = cloneJsonCacheValue(value);
    if (cloned === undefined) return false;
    const previous = this.entries.get(key);
    if (previous) this.totalBytes -= previous.bytes;
    this.entries.delete(key);
    this.entries.set(key, { value: cloned, bytes });
    this.totalBytes += bytes;
    while (this.entries.size > this.maxEntries || this.totalBytes > this.maxBytes) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      const entry = this.entries.get(oldest);
      this.entries.delete(oldest);
      if (entry) this.totalBytes -= entry.bytes;
    }
    return this.entries.has(key);
  }

  clear(): void {
    this.entries.clear();
    this.totalBytes = 0;
  }

  get stats(): AnalysisCacheStats {
    return {
      hits: this.hitCount,
      misses: this.missCount,
      entries: this.entries.size,
      bytes: this.totalBytes,
      maxEntries: this.maxEntries,
      maxBytes: this.maxBytes,
    };
  }
}
