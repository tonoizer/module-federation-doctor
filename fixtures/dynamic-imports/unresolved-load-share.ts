import { loadShare } from "@module-federation/runtime";

export async function ensureShared(name: string) {
  return loadShare(name);
}
