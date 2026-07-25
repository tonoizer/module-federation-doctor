declare function registerRemotes(remotes: Array<{ name: string; entry: string }>): void;

export function registerCheckout() {
  registerRemotes([
    {
      name: "checkout",
      entry: "https://cdn.example.com/checkout/mf-manifest.json",
    },
  ]);
}
