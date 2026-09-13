import type { loadRemote as remote } from "@module-federation/runtime";
import { type loadShare as typedShare } from "@module-federation/runtime";
export type { Remote } from "@module-federation/runtime";
export { type Remote as ReExportedRemote } from "@module-federation/runtime";
export type * from "@module-federation/runtime";

type RemoteFromRuntime = import("@module-federation/runtime").Remote;
type RemoteLoader = typeof remote;
type SharedLoader = typeof typedShare;
void (0 as unknown as RemoteFromRuntime);
void (0 as unknown as RemoteLoader);
void (0 as unknown as SharedLoader);
