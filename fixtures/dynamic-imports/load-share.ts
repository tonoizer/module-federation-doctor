declare function loadShare(id: string): Promise<unknown>;

export async function ensureReact() {
  return loadShare("react");
}
