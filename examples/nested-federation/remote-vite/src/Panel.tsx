import { nestedCardStyle } from "@mfdoctor-example/nested-shared-ui";
import React from "react";
import "react-dom";

// Vite 8/Rolldown cannot bind named ESM imports from MF's CJS react loadShare
// virtual module. Take Suspense/lazy from the default CJS namespace instead.
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
