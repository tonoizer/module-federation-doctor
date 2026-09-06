import { reactFromLoadShare } from "@mfdoctor-example/shared-ui";
import reactShare from "react";
import { createRoot } from "react-dom/client";
import "react/jsx-runtime";

// Vite 8/Rolldown does not honor syntheticNamedExports on MF's CJS react
// loadShare module, so `import { Suspense, lazy } from "react"` fails with
// MISSING_EXPORT. The default export may be React or `{ default: React }`.
const React = reactFromLoadShare<typeof import("react")>(reactShare);
const { Suspense, lazy } = React;

const RspackCard = lazy(() => import("rspackRemote/Card"));
const RsbuildCard = lazy(() => import("rsbuildRemote/Card"));

function App() {
  return (
    <main>
      <h1>MFDoctor mixed example</h1>
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
