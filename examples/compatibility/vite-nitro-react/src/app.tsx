import reactShare from "react";
import "react/jsx-runtime";

// Vite 8/Rolldown cannot bind named ESM imports from MF's CJS react loadShare
// virtual module. Unwrap `{ default: React }` so hooks exist at runtime.
function reactFromLoadShare(mod: unknown): typeof import("react") {
  let current: { useState?: unknown; default?: unknown } | undefined = mod as {
    useState?: unknown;
    default?: unknown;
  };
  for (let i = 0; i < 4; i += 1) {
    if (current && typeof current.useState === "function") return current as typeof import("react");
    current = current?.default as typeof current;
  }
  throw new Error("shared react loadShare module did not expose useState");
}

const React = reactFromLoadShare(reactShare);
const { useState } = React;

export function App() {
  const [count, setCount] = useState(0);
  return (
    <>
      <h1 className="hero">Nitro + Vite + React + Module Federation</h1>
      <button onClick={() => setCount((value) => value + 1)}>Count is {count}</button>
    </>
  );
}
