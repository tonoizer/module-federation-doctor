import { nestedCardStyle } from "@mfdoctor-example/nested-shared-ui";
import { Suspense, lazy } from "react";
import "react-dom";

const WebpackWidget = lazy(() => import("webpackRemote/Widget"));

export default function Card() {
  return (
    <article style={nestedCardStyle} data-testid="nested-rsbuild-remote">
      <strong>Rsbuild remote</strong>
      <p>Loads a Webpack leaf underneath.</p>
      <Suspense fallback={<p>Loading Webpack leaf…</p>}>
        <p data-testid="nested-webpack-leaf">
          <WebpackWidget />
        </p>
      </Suspense>
    </article>
  );
}
