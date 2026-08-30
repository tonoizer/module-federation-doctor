import { renderToString } from "react-dom/server";

export function renderPage(element: unknown) {
  return renderToString(element as never);
}
