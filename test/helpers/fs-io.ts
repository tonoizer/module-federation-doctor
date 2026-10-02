import fs from "node:fs/promises";
import path from "node:path";
import { vi } from "vitest";

function matchesPath(file: unknown, absolutePath: string): boolean {
  return path.resolve(String(file)) === path.resolve(absolutePath);
}

// Capture before tests spy on the module namespace (ESM live bindings).
const realReadFile = fs.readFile;
const realOpen = fs.open;

type RestoreHandle = { restore(): void; mockRestore(): void };

function restoreHandle(restore: () => void): RestoreHandle {
  return { restore, mockRestore: restore };
}

/**
 * Collect reads reserved sources via `fs.open` after skip-before-read `stat`.
 * Mock both `open` and leftover `readFile` callers for a disappearing file.
 */
export function mockUnreadablePath(
  absolutePath: string,
  error: Error = new Error("fixture read failed"),
): RestoreHandle {
  const readFileSpy = vi.spyOn(fs, "readFile").mockImplementation(async (file, options) => {
    if (matchesPath(file, absolutePath)) throw error;
    return realReadFile(file, options);
  });
  const openSpy = vi.spyOn(fs, "open").mockImplementation((file, flags, mode) => {
    if (matchesPath(file, absolutePath)) return Promise.reject(error);
    return realOpen(file, flags, mode);
  });
  return restoreHandle(() => {
    readFileSpy.mockRestore();
    openSpy.mockRestore();
  });
}

/** Count collect `open` and leftover `readFile` of one absolute path. */
export function countPathReads(absolutePath: string): RestoreHandle & { reads(): number } {
  let reads = 0;
  const bump = (file: unknown) => {
    if (matchesPath(file, absolutePath)) reads += 1;
  };
  const readFileSpy = vi.spyOn(fs, "readFile").mockImplementation(async (file, options) => {
    bump(file);
    return realReadFile(file, options);
  });
  const openSpy = vi.spyOn(fs, "open").mockImplementation((file, flags, mode) => {
    bump(file);
    return realOpen(file, flags, mode);
  });
  return {
    reads: () => reads,
    ...restoreHandle(() => {
      readFileSpy.mockRestore();
      openSpy.mockRestore();
    }),
  };
}
