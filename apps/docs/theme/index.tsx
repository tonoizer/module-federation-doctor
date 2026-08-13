import { Layout as OriginalLayout } from "@rspress/core/theme-original";
import { Link } from "@rspress/core/theme";
import { withBase } from "@rspress/core/runtime";

import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";

import { HomePage } from "./HomePage";
import "./index.css";

export * from "@rspress/core/theme-original";

function Brand() {
  return (
    <Link className="kb-brand" href={withBase("/")} aria-label="MFDoctor home">
      <span className="kb-brand__mark">
        <img src={withBase("/mfdoctor-mark.svg")} alt="" />
      </span>
      <span>MFDoctor</span>
    </Link>
  );
}

export function Layout() {
  return <OriginalLayout navTitle={<Brand />} afterHero={<HomePage />} />;
}
