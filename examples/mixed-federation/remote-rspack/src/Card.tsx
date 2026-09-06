import { remoteCardStyle } from "@mfdoctor-example/shared-ui";
import "react";
import "react-dom";
import "react/jsx-runtime";

export default function Card() {
  return (
    <article style={remoteCardStyle}>
      <strong>Direct Rspack remote</strong>
      <p>Exposed module loaded.</p>
    </article>
  );
}
