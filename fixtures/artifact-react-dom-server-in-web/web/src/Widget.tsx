import { renderToString } from "react-dom/server";

export function Widget() {
  // Accidental server API in a browser MF remote — crashes at runtime.
  return renderToString(<div>widget</div>);
}
