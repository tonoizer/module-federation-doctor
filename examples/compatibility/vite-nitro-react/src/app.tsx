import React from "react";

// Vite 8/Rolldown cannot bind named ESM imports from MF's CJS react loadShare
// virtual module. Take hooks from the default CJS namespace instead.
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
