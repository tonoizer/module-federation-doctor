import fs from "node:fs/promises";
import path from "node:path";

/** Outcome of static runtime-plugin contract inspection. */
export type PluginContractStatus =
  | { kind: "skip"; reason: "not-local" | "unreadable" | "ambiguous" }
  | { kind: "ok" }
  | {
      kind: "invalid-factory";
      reason: "no-export" | "non-factory-export" | "missing-name";
    }
  | {
      kind: "cors-parity";
      reason: "create-script-without-create-link" | "cors-mismatch";
      confidence: "clear" | "heuristic";
    };

const LOCAL_PREFIX = /^[./]/;
const EXT_CANDIDATES = ["", ".ts", ".tsx", ".js", ".mjs", ".cjs", "/index.ts", "/index.js"];

/** True when the configured plugin path is a project-local module we may read. */
export function isLocalPluginPath(plugin: string): boolean {
  return LOCAL_PREFIX.test(plugin);
}

/**
 * Resolve a local runtimePlugins path against the project root and scanned files.
 * Returns undefined when no candidate exists on disk (caller should skip — do not invent).
 */
export async function resolveLocalPluginFile(
  root: string,
  plugin: string,
  sourceFiles: readonly string[],
): Promise<string | undefined> {
  if (!isLocalPluginPath(plugin)) return undefined;
  const normalized = plugin.replaceAll("\\", "/").replace(/^\.\/+/, "");
  const files = new Set(sourceFiles.map((file) => file.replaceAll("\\", "/")));
  const candidates = EXT_CANDIDATES.map((ext) => `${normalized}${ext}`.replace(/^\.\/+/, ""));

  for (const candidate of candidates) {
    if (files.has(candidate) || files.has(`./${candidate}`)) {
      const absolute = path.resolve(root, candidate);
      try {
        await fs.access(absolute);
        return absolute;
      } catch {
        // Fall through to disk probe below.
      }
    }
  }

  for (const candidate of candidates) {
    const absolute = path.resolve(root, candidate);
    try {
      await fs.access(absolute);
      return absolute;
    } catch {
      // Keep probing.
    }
  }
  return undefined;
}

export async function readPluginSource(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/^\s*#.*$/gm, "");
}

function hasUsableExport(source: string): boolean {
  return (
    /\bexport\s+default\b/.test(source) ||
    /\bexport\s+(?:async\s+)?function\b/.test(source) ||
    /\bexport\s+(?:const|let|var|class)\b/.test(source) ||
    /\bmodule\.exports\b/.test(source) ||
    /\bexports\.\w+\s*=/.test(source)
  );
}

/**
 * Detect a default/named factory that clearly cannot be a runtime plugin, or lacks `name`.
 * Returns ambiguous when static shape is too complex to judge confidently.
 */
export function inspectPluginFactory(source: string): PluginContractStatus {
  const text = stripComments(source);
  if (!text.trim()) return { kind: "invalid-factory", reason: "no-export" };
  if (!hasUsableExport(text)) return { kind: "invalid-factory", reason: "no-export" };

  // Default export of a primitive / empty object — clear silent no-op.
  if (/\bexport\s+default\s+(?:null|undefined|true|false|\d+|['"`])/.test(text))
    return { kind: "invalid-factory", reason: "non-factory-export" };
  if (/\bexport\s+default\s*\{\s*\}/.test(text))
    return { kind: "invalid-factory", reason: "missing-name" };

  // `export default { ... }` object plugin (registerPlugins style).
  const objectPlugin = text.match(/\bexport\s+default\s*\{([\s\S]*?)\n\}/);
  if (objectPlugin) {
    const body = objectPlugin[1] ?? "";
    if (!/\bname\s*:/.test(body)) return { kind: "invalid-factory", reason: "missing-name" };
    return { kind: "ok" };
  }

  // Factory that returns an object literal we can see.
  const returnObject = [...text.matchAll(/\breturn\s*\{([\s\S]*?)\}/g)].map(
    (match) => match[1] ?? "",
  );
  const factoryLike =
    /\bexport\s+default\s+(?:async\s+)?function\b/.test(text) ||
    /\bexport\s+default\s+(?:async\s+)?\([^)]*\)\s*=>/.test(text) ||
    /\bexport\s+default\s+(?:async\s+)?[\w$]+\s*=>/.test(text) ||
    /\bmodule\.exports\s*=\s*(?:async\s+)?function\b/.test(text) ||
    /\bmodule\.exports\s*=\s*(?:async\s+)?\([^)]*\)\s*=>/.test(text);

  if (factoryLike && returnObject.length > 0) {
    const named = returnObject.some((body) => /\bname\s*:/.test(body));
    if (!named) return { kind: "invalid-factory", reason: "missing-name" };
    return { kind: "ok" };
  }

  // Named `export function foo` / `export const foo =` without a default — MF expects
  // the module default (or CJS exports) to be the factory. Clear when only type exports.
  if (
    /\bexport\s+type\b/.test(text) &&
    !/\bexport\s+default\b/.test(text) &&
    !/\bexport\s+(?:async\s+)?function\b/.test(text) &&
    !/\bexport\s+(?:const|let|var)\b/.test(text) &&
    !/\bmodule\.exports\b/.test(text)
  )
    return { kind: "invalid-factory", reason: "no-export" };

  // Readable but not confidently broken — do not invent a fail.
  if (factoryLike || /\bexport\s+default\b/.test(text) || /\bmodule\.exports\b/.test(text))
    return { kind: "skip", reason: "ambiguous" };

  return { kind: "skip", reason: "ambiguous" };
}

function hookDefined(source: string, hook: "createScript" | "createLink" | "fetch"): boolean {
  const pattern = new RegExp(`(?:\\b${hook}\\s*[:(]|['"\`]${hook}['"\`]\\s*:)`);
  return pattern.test(source);
}

function mentionsCors(source: string): boolean {
  return /crossOrigin|crossorigin|credentials\s*:|['"`]include['"`]|['"`]anonymous['"`]|['"`]use-credentials['"`]/.test(
    source,
  );
}

function extractHookBody(source: string, hook: string): string | undefined {
  const match = source.match(
    new RegExp(
      `(?:\\b${hook}\\s*(?:\\(|:)\\s*(?:async\\s*)?(?:\\([^)]*\\)\\s*=>|function\\s*\\([^)]*\\)\\s*)?\\{)([\\s\\S]*?)\\n\\s*\\}`,
    ),
  );
  return match?.[1];
}

/**
 * Detect createScript / createLink CORS asymmetry from plugin source text.
 * Clear: createScript path sets CORS-related attributes and createLink is absent
 * (or createLink present but has no CORS signal while createScript does).
 * Heuristic: createScript present without createLink and no CORS signal on either.
 */
export function inspectCorsParity(source: string): PluginContractStatus {
  const text = stripComments(source);
  const hasScript = hookDefined(text, "createScript");
  if (!hasScript) return { kind: "ok" };

  const hasLink = hookDefined(text, "createLink");
  const scriptCors = mentionsCors(extractHookBody(text, "createScript") ?? (hasScript ? text : ""));
  const linkCors = hasLink ? mentionsCors(extractHookBody(text, "createLink") ?? text) : false;

  if (scriptCors && !hasLink)
    return {
      kind: "cors-parity",
      reason: "create-script-without-create-link",
      confidence: "clear",
    };

  if (scriptCors && hasLink && !linkCors)
    return { kind: "cors-parity", reason: "cors-mismatch", confidence: "clear" };

  if (!hasLink)
    return {
      kind: "cors-parity",
      reason: "create-script-without-create-link",
      confidence: "heuristic",
    };

  return { kind: "ok" };
}

export async function analyzeLocalRuntimePlugin(
  root: string,
  plugin: string,
  sourceFiles: readonly string[],
): Promise<{
  plugin: string;
  file?: string;
  factory: PluginContractStatus;
  cors: PluginContractStatus;
}> {
  if (!isLocalPluginPath(plugin))
    return {
      plugin,
      factory: { kind: "skip", reason: "not-local" },
      cors: { kind: "skip", reason: "not-local" },
    };

  const file = await resolveLocalPluginFile(root, plugin, sourceFiles);
  if (!file)
    return {
      plugin,
      factory: { kind: "skip", reason: "unreadable" },
      cors: { kind: "skip", reason: "unreadable" },
    };

  const source = await readPluginSource(file);
  if (source === undefined)
    return {
      plugin,
      file,
      factory: { kind: "skip", reason: "unreadable" },
      cors: { kind: "skip", reason: "unreadable" },
    };

  return {
    plugin,
    file,
    factory: inspectPluginFactory(source),
    cors: inspectCorsParity(source),
  };
}
