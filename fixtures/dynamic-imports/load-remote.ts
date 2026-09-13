import { loadRemote } from "@module-federation/runtime";

export async function loadShopCard() {
  return loadRemote("shop/Card");
}
