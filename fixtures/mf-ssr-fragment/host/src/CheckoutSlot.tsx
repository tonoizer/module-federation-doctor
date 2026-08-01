/**
 * Host-side mf-ssr fragment URL mode (stubs — no mf-toolkit dependency).
 * Uses a fragment HTTP endpoint, not classic remoteEntry.js.
 */

type MFBridgeSSRProps = {
  url: string;
  namespace?: string;
  props: Record<string, unknown>;
};

function MFBridgeSSR(_props: MFBridgeSSRProps) {
  return null;
}

/** Fragment endpoint — intentional toolkit shape, not a classic remote entry. */
export const CHECKOUT_FRAGMENT_URL = "https://checkout.example.com/api/fragments/checkout";

export function CheckoutSlot({ cartId }: { cartId: string }) {
  return <MFBridgeSSR url={CHECKOUT_FRAGMENT_URL} namespace="checkout" props={{ cartId }} />;
}
