import { registerRemotes } from "@module-federation/runtime";

export function registerCheckout() {
  registerRemotes([
    {
      name: "checkout",
      entry: "https://cdn.example.com/checkout/mf-manifest.json",
    },
  ]);
}
