import type { ProjectFacts, SplitChunksCacheGroupFacts, SplitChunksFacts } from "./types.js";

const MF_RUNTIME_TOKEN =
  /(?:^|[^a-z0-9])(?:mf[-_][\w.-]*|mf[A-Z][\w.-]*|remote[-_]?entry|__federation(?:_shared)?[\w.-]*|federation[-_]?shared[\w.-]*|consume[-_]?shared[\w.-]*|provide[-_]?shared[\w.-]*)(?:$|[^a-z0-9])/i;

const SPLIT_CHUNKS_BUNDLERS = new Set(["webpack", "rspack", "rsbuild"]);

export function isSplitChunksBundler(name: string): boolean {
  return SPLIT_CHUNKS_BUNDLERS.has(name);
}

function chunkStem(value: string): string {
  const base = value.replace(/\\/g, "/").split("/").pop() ?? value;
  return base.replace(/\.[cm]?js(?:\.map)?$/i, "");
}

/** True when a public identifier names an MF runtime / remoteEntry / shared-runtime chunk. */
export function isMfRuntimeChunkToken(value: string): boolean {
  const stem = chunkStem(value.trim());
  return stem.length > 0 && MF_RUNTIME_TOKEN.test(stem);
}

function serializeTest(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  if (value instanceof RegExp) return value.source;
  return undefined;
}

function serializeChunkName(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function serializeCacheGroups(cacheGroups: unknown): SplitChunksCacheGroupFacts[] {
  if (!cacheGroups || typeof cacheGroups !== "object" || Array.isArray(cacheGroups)) return [];
  const groups: SplitChunksCacheGroupFacts[] = [];
  for (const [name, spec] of Object.entries(cacheGroups as Record<string, unknown>)) {
    if (!name || spec === false) continue;
    const group: SplitChunksCacheGroupFacts = { name };
    if (spec && typeof spec === "object") {
      const record = spec as {
        name?: unknown;
        filename?: unknown;
        idHint?: unknown;
        test?: unknown;
      };
      const chunkName =
        serializeChunkName(record.name) ??
        serializeChunkName(record.filename) ??
        serializeChunkName(record.idHint);
      if (chunkName) group.chunkName = chunkName;
      const test = serializeTest(record.test);
      if (test) group.test = test;
    } else if (typeof spec === "string") {
      group.chunkName = spec;
    }
    groups.push(group);
  }
  return groups.sort((left, right) => left.name.localeCompare(right.name));
}

function mergeCacheGroups(
  target: SplitChunksCacheGroupFacts[],
  incoming: SplitChunksCacheGroupFacts[],
): SplitChunksCacheGroupFacts[] {
  const byName = new Map(target.map((group) => [group.name, { ...group }]));
  for (const group of incoming) {
    const existing = byName.get(group.name);
    if (!existing) {
      byName.set(group.name, { ...group });
      continue;
    }
    if (!existing.chunkName && group.chunkName) existing.chunkName = group.chunkName;
    if (!existing.test && group.test) existing.test = group.test;
  }
  return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * Public webpack/rspack `optimization.splitChunks` snapshot.
 * `false` is observed (splitting disabled). Functions are omitted.
 */
export function extractWebpackSplitChunksFacts(splitChunks: unknown): SplitChunksFacts {
  const facts: SplitChunksFacts = {};
  if (splitChunks === false) return facts;
  if (!splitChunks || typeof splitChunks !== "object") return facts;
  const record = splitChunks as { chunks?: unknown; cacheGroups?: unknown };
  if (typeof record.chunks === "string" && record.chunks.length > 0) facts.chunks = record.chunks;
  const groups = serializeCacheGroups(record.cacheGroups);
  if (groups.length > 0) facts.cacheGroups = groups;
  return facts;
}

function extractForceSplittingGroups(forceSplitting: unknown): SplitChunksCacheGroupFacts[] {
  if (!forceSplitting || typeof forceSplitting !== "object") return [];
  if (Array.isArray(forceSplitting)) {
    return forceSplitting.flatMap((entry, index) => {
      if (typeof entry === "string" && isMfRuntimeChunkToken(entry))
        return [{ name: `forceSplitting-${index}`, test: entry }];
      if (entry instanceof RegExp) return [{ name: `forceSplitting-${index}`, test: entry.source }];
      return [];
    });
  }
  return serializeCacheGroups(forceSplitting);
}

function toolsSplitChunks(toolsEntry: unknown): unknown {
  if (!toolsEntry || typeof toolsEntry !== "object" || Array.isArray(toolsEntry)) return undefined;
  const optimization = (toolsEntry as { optimization?: { splitChunks?: unknown } }).optimization;
  return optimization?.splitChunks;
}

/**
 * Public Rsbuild splitChunks surfaces: `performance.chunkSplit.override`,
 * `performance.chunkSplit.forceSplitting`, and object-form `tools.rspack` /
 * `tools.bundler` `optimization.splitChunks`. Function `tools.rspack` is skipped.
 */
export function extractRsbuildSplitChunksFacts(config: unknown): SplitChunksFacts | undefined {
  if (!config || typeof config !== "object") return undefined;
  const facts: SplitChunksFacts = {};
  const performance = (config as { performance?: { chunkSplit?: unknown } }).performance;
  const chunkSplit = performance?.chunkSplit;
  if (chunkSplit && typeof chunkSplit === "object") {
    const override = (chunkSplit as { override?: unknown }).override;
    Object.assign(facts, extractWebpackSplitChunksFacts(override));
    const forced = extractForceSplittingGroups(
      (chunkSplit as { forceSplitting?: unknown }).forceSplitting,
    );
    if (forced.length > 0) facts.cacheGroups = mergeCacheGroups(facts.cacheGroups ?? [], forced);
  }
  const tools = (config as { tools?: { rspack?: unknown; bundler?: unknown } }).tools;
  for (const entry of [tools?.rspack, tools?.bundler]) {
    const splitChunks = toolsSplitChunks(entry);
    if (splitChunks === undefined) continue;
    const extracted = extractWebpackSplitChunksFacts(splitChunks);
    if (extracted.chunks && !facts.chunks) facts.chunks = extracted.chunks;
    if (extracted.cacheGroups?.length)
      facts.cacheGroups = mergeCacheGroups(facts.cacheGroups ?? [], extracted.cacheGroups);
  }
  return facts;
}

/**
 * Webpack/Rspack compiler `optimization` snapshot. Missing `optimization` is
 * unobserved (`undefined`). Present optimization — even without `splitChunks` —
 * is observed so the rule can pass instead of skipping.
 */
export function extractCompilerSplitChunksFacts(
  optimization: unknown,
): SplitChunksFacts | undefined {
  if (optimization === undefined) return undefined;
  if (!optimization || typeof optimization !== "object") return {};
  if (!("splitChunks" in optimization)) return {};
  return extractWebpackSplitChunksFacts((optimization as { splitChunks?: unknown }).splitChunks);
}

function extraMfRuntimeNames(facts: ProjectFacts): string[] {
  const names = new Set<string>();
  const filename = facts.moduleFederation?.filename;
  if (typeof filename === "string" && filename.trim()) names.add(chunkStem(filename));
  for (const asset of facts.artifacts.emittedAssets ?? []) {
    const stem = chunkStem(asset);
    if (isMfRuntimeChunkToken(stem) || isMfRuntimeChunkToken(asset)) names.add(stem);
  }
  const remoteEntry = facts.artifacts.manifest?.remoteEntry?.name;
  if (typeof remoteEntry === "string" && remoteEntry.trim()) names.add(chunkStem(remoteEntry));
  return [...names].filter((name) => name.length > 0);
}

function identifierTargetsMfRuntime(value: string | undefined, extras: string[]): boolean {
  if (!value) return false;
  if (isMfRuntimeChunkToken(value)) return true;
  const hay = value.toLowerCase();
  return extras.some((extra) => {
    const needle = extra.toLowerCase();
    return hay === needle || hay.includes(needle);
  });
}

function testTargetsMfRuntime(test: string | undefined, extras: string[]): boolean {
  if (!test) return false;
  if (isMfRuntimeChunkToken(test)) return true;
  const lower = test.toLowerCase();
  if (extras.some((extra) => extra && lower.includes(extra.toLowerCase()))) return true;
  try {
    const pattern = new RegExp(test, "i");
    return extras.some((extra) => extra.length > 0 && pattern.test(extra));
  } catch {
    return false;
  }
}

/** Public cacheGroups whose key, name, or test targets MF runtime chunk names. */
export function conflictingSplitChunksCacheGroups(
  splitChunks: SplitChunksFacts,
  facts: ProjectFacts,
): SplitChunksCacheGroupFacts[] {
  const extras = extraMfRuntimeNames(facts);
  return (splitChunks.cacheGroups ?? []).filter(
    (group) =>
      identifierTargetsMfRuntime(group.name, extras) ||
      identifierTargetsMfRuntime(group.chunkName, extras) ||
      testTargetsMfRuntime(group.test, extras),
  );
}
