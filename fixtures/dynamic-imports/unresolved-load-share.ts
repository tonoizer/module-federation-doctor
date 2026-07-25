declare function loadShare(id: string): Promise<unknown>;

export async function ensureShared(name: string) {
  return loadShare(name);
}
