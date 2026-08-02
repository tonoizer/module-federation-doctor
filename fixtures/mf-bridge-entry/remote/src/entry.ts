/**
 * Minimal mf-bridge remote entry shape (stubs only — do not vendor mf-toolkit).
 * Remote exposes `./entry`; host loads via `register={() => import('remote/entry')}`.
 */

export type RegisterFn = (container: unknown, props?: Record<string, unknown>) => () => void;

/** Stub for createMFEntry — real toolkit returns a register function. */
export function createMFEntry(
  _Component: unknown,
  _setup?: (api: { emit: (...args: unknown[]) => void; onCommand: (h: unknown) => void }) => void,
): RegisterFn {
  return () => () => undefined;
}

/** Stub for defineMFEntry — framework-agnostic bridge entry. */
export function defineMFEntry(_config: {
  mount: (el: unknown, props: unknown) => unknown;
  update?: (instance: unknown, props: unknown) => void;
  unmount: (instance: unknown) => void;
}): RegisterFn {
  return () => () => undefined;
}

export const register = createMFEntry({ displayName: "CheckoutWidget" });
