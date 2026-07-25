import { nestedCardStyle } from "@mfdoctor-example/nested-shared-ui";
import "react";
import "react-dom";

export default function Card() {
  return (
    <article style={nestedCardStyle} data-testid="nested-rspack-leaf">
      <strong>Rspack leaf remote</strong>
      <p>Loaded under the Vite intermediate remote.</p>
    </article>
  );
}
