import { loadRemote as remote, loadShare } from "@module-federation/runtime";
import * as mf from "@module-federation/runtime";

export function loadUnknown(remoteId: string, sharedId: string) {
  remote(remoteId);
  mf.loadRemote(remoteId);
  loadShare(sharedId);
  mf.loadShareSync(sharedId);
}
