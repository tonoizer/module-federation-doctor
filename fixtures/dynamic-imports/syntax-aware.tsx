import type { ReactNode } from "react";

export function Widget(props: { children?: ReactNode }) {
  return <section>{props.children}</section>;
}

export const lazy = () => import("lodash");
export const remote = () => loadRemote("shop/Card");
export const shared = (name: string) => loadShare(name);
