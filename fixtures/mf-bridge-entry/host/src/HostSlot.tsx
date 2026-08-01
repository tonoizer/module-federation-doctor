/**
 * Host-side mf-bridge lazy register shape (stubs — no mf-toolkit dependency).
 * Mirrors: register={() => import('remote/entry').then((m) => m.register)}
 */

type RegisterFn = (container: unknown, props?: Record<string, unknown>) => () => void;

type MFBridgeLazyProps = {
  register: () => Promise<RegisterFn>;
  props: Record<string, unknown>;
};

function MFBridgeLazy(_props: MFBridgeLazyProps) {
  return null;
}

export function HostSlot() {
  return (
    <MFBridgeLazy
      register={() => import("remote/entry").then((m) => m.register as RegisterFn)}
      props={{ cartId: "demo" }}
    />
  );
}
