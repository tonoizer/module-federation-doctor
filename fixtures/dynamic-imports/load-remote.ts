declare function loadRemote(id: string): Promise<unknown>;

export async function loadShopCard() {
  return loadRemote("shop/Card");
}
