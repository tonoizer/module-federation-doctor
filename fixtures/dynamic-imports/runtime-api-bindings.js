import {
  loadRemote as remote,
  loadShare as share,
  loadShareSync as syncShare,
  registerRemotes as register,
} from "@module-federation/runtime";
import * as mf from "@module-federation/runtime";

export async function loadFederatedModules() {
  await remote("shop/Card");
  await share("react");
  await syncShare("react-dom");
  await mf.loadRemote("catalog/Widget");
  await mf.loadShare("router");
  await mf.loadShareSync("state");
  register([{ alias: "checkout", entry: "https://cdn.example.com/checkout.js" }]);
}
