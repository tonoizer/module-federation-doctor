import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Write `contents` via a same-directory temp file and rename so a crash never
 * leaves a truncated final path. On failure the previous file (if any) is kept
 * and the temp file is removed.
 */
export async function writeFileAtomic(
  filePath: string,
  contents: string,
  options: {
    mode?: number;
    errorMessage?: (resolved: string) => string;
  } = {},
): Promise<void> {
  const resolved = path.resolve(filePath);
  const directory = path.dirname(resolved);
  const temporary = path.join(
    directory,
    `.${path.basename(resolved)}.mfdoctor-${process.pid}-${randomUUID()}.tmp`,
  );
  let handle: fs.FileHandle | undefined;
  let renamed = false;
  try {
    handle =
      options.mode === undefined
        ? await fs.open(temporary, "wx")
        : await fs.open(temporary, "wx", options.mode);
    await handle.writeFile(contents, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.rename(temporary, resolved);
    renamed = true;
  } catch (error) {
    throw new Error(
      options.errorMessage?.(resolved) ?? `Unable to atomically write file: ${resolved}`,
      { cause: error },
    );
  } finally {
    await handle?.close().catch(() => undefined);
    if (!renamed) await fs.rm(temporary, { force: true }).catch(() => undefined);
  }
}
