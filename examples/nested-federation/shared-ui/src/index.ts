export const nestedCardStyle = {
  border: "1px solid #0f766e",
  borderRadius: "12px",
  padding: "16px",
  background: "#f0fdfa",
  marginBottom: "12px",
} as const;

/**
 * `@module-federation/vite` rewrites shared `react` through a virtual CJS
 * loadShare module. Rolldown does not honor `syntheticNamedExports`, so the
 * import may be React itself or `{ default: React }` wrappers. Walk `.default`
 * until `Suspense` / `useState` exist so JSX and lazy() work at runtime.
 */
export function reactFromLoadShare<T extends { Suspense?: unknown; useState?: unknown }>(
  mod: unknown,
): T {
  let current: { Suspense?: unknown; useState?: unknown; default?: unknown } | undefined = mod as {
    Suspense?: unknown;
    useState?: unknown;
    default?: unknown;
  };
  for (let i = 0; i < 4; i += 1) {
    if (
      current &&
      (typeof current.Suspense === "function" || typeof current.useState === "function")
    ) {
      return current as T;
    }
    current = current?.default as typeof current;
  }
  throw new Error("shared react loadShare module did not expose Suspense or useState");
}
