import React from "react";
import { createRoot } from "react-dom/client";

// Vite 8/Rolldown cannot bind named ESM imports from MF's CJS react loadShare
// virtual module. Take Suspense/lazy from the default CJS namespace instead.
const { Suspense, lazy } = React;

const RspackCard = lazy(() => import("rspackRemote/Card"));
const RsbuildCard = lazy(() => import("rsbuildRemote/Card"));

function App() {
  return (
    <main>
      <h1>MFDoctor mixed issues example</h1>
      <p>This host is intentionally misconfigured for MFDoctor demos.</p>
      <Suspense fallback={<p data-testid="remote-loading">Loading remotes…</p>}>
        <section data-testid="rspack-remote">
          <RspackCard />
        </section>
        <section data-testid="rsbuild-remote">
          <RsbuildCard />
        </section>
      </Suspense>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
