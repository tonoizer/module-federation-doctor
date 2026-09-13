import { loadShare } from "@module-federation/runtime";

export async function ensureReact() {
  return loadShare("react");
}
