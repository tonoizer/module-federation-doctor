import { nestedCardStyle, reactFromLoadShare } from "@mfdoctor-example/nested-shared-ui";
import reactShare from "react";
import "react-dom";
import "react/jsx-runtime";

// Vite 8/Rolldown cannot bind named ESM imports from MF's CJS react loadShare
// virtual module. Unwrap `{ default: React }` so Suspense/lazy exist at runtime.
const React = reactFromLoadShare<typeof import("react")>(reactShare);
const { Suspense, lazy } = React;

const RspackCard = lazy(() => import("rspackRemote/Card"));

export default function Panel() {
  return (
    <section style={nestedCardStyle} data-testid="nested-vite-remote">
      <strong>Vite intermediate remote</strong>
      <p>Loads an Rspack leaf underneath.</p>
      <Suspense fallback={<p>Loading Rspack leaf…</p>}>
        <RspackCard />
      </Suspense>
    </section>
  );
}
