import { Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";

const RspackCard = lazy(() => import("rspackRemote/Card"));
const RsbuildCard = lazy(() => import("rsbuildRemote/Card"));

function App() {
  return (
    <main>
      <h1>Module Federation Doctor mixed issues example</h1>
      <p>This host is intentionally misconfigured for Doctor demos.</p>
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
