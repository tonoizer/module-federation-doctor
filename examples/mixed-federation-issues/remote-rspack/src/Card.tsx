import { remoteCardStyle } from "@mfdoctor-example/shared-ui";
import "react";
import "react-dom";

export default function Card() {
  return (
    <article style={remoteCardStyle}>
      <strong>Broken Rspack remote</strong>
      <p>React 18 installed against a ^19 requiredVersion, non-singleton shared.</p>
    </article>
  );
}
