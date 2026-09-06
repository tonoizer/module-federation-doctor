import { reactFromLoadShare } from "@mfdoctor-example/shared-ui";
import reactShare from "react";
import { createRoot } from "react-dom/client";
import "react/jsx-runtime";

// Vite 8/Rolldown cannot bind named ESM imports from MF's CJS react loadShare
// virtual module. Unwrap `{ default: React }` so Suspense/lazy exist at runtime.
const React = reactFromLoadShare<typeof import("react")>(reactShare);
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
