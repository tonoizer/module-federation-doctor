import { nestedCardStyle } from "@mfdoctor-example/nested-shared-ui";
import { Suspense, lazy } from "react";
import "react-dom";

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
