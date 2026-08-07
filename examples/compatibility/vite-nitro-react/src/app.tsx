import { useState } from "react";

export function App() {
  const [count, setCount] = useState(0);
  return (
    <>
      <h1 className="hero">Nitro + Vite + React + Module Federation</h1>
      <button onClick={() => setCount((value) => value + 1)}>Count is {count}</button>
    </>
  );
}
