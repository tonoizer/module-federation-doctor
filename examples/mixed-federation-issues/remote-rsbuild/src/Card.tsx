import { remoteCardStyle } from "@mfdoctor-example/shared-ui";
import "react";
import "react-dom";

export default function Card() {
  return (
    <article style={remoteCardStyle}>
      <strong>Broken Rsbuild remote</strong>
      <p>Shares React on the legacy share scope.</p>
    </article>
  );
}
