import { Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";

const VitePanel = lazy(() => import("viteRemote/Panel"));
const RsbuildCard = lazy(() => import("rsbuildRemote/Card"));

function App() {
  return (
    <main>
      <h1>MFDoctor nested example</h1>
      <p>Vite host → Vite + Rsbuild remotes; each remote nests another bundler.</p>
      <Suspense fallback={<p data-testid="remote-loading">Loading remotes…</p>}>
        <section data-testid="vite-remote">
          <VitePanel />
        </section>
        <section data-testid="rsbuild-remote">
          <RsbuildCard />
        </section>
      </Suspense>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
