import { remoteCardStyle } from "@mfdoctor-example/shared-ui";
import "react";
import "react-dom";

export default function Card() {
  return (
    <article style={remoteCardStyle}>
      <strong>Rsbuild remote</strong>
      <p>Exposed module loaded.</p>
    </article>
  );
}
