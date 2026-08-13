import { Layout as OriginalLayout } from "@rspress/core/theme-original";
import { withBase } from "@rspress/core/runtime";

import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";

import { HomePage } from "./HomePage";
import "./index.css";

export * from "@rspress/core/theme-original";

function Brand() {
  return (
    <span className="kb-brand">
      <span className="kb-brand__mark">
        <img src={withBase("/module-federation-doctor-mark.svg")} alt="" />
        <span className="kb-brand__status" aria-hidden="true" />
      </span>
      <span>Doctor</span>
    </span>
  );
}

export function Layout() {
  return <OriginalLayout navTitle={<Brand />} afterHero={<HomePage />} />;
}
