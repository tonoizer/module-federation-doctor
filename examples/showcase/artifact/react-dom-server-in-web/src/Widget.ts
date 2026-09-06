import { renderToString } from "react-dom/server";

export function Widget() {
  // Accidental server renderer in a web/client MF remote.
  return renderToString("widget");
}
