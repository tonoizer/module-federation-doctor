/**
 * Remote-side mf-ssr fragment handler stub (HTTP HTML fragment, not remoteEntry.js).
 */

export type FragmentHandler = (req: Request) => Promise<Response>;

export const fragmentHandler: FragmentHandler = async () =>
  new Response('<div data-mf-ssr="checkout">checkout</div>', {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
