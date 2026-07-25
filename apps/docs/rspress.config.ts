import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@rspress/core";

const docsAppDir = path.dirname(fileURLToPath(import.meta.url));
// Absolute origin for OG/Twitter image URLs in the built site.
// Default stays module-federation.github.io (planned org docs host) even while
// the GitHub repo lives under tonoizer — override with SITE_ORIGIN when
// deploying elsewhere (for example a Pages preview or custom domain).
// Terminal/SARIF rule links use the same default via DOCTOR_DOCS_ORIGIN in src/reporters.ts.
const siteOrigin = (process.env.SITE_ORIGIN || "https://module-federation.github.io").replace(
  /\/$/,
  "",
);
const siteIcon = "/doctor-icon.svg";
const socialImageUrl = `${siteOrigin}/doctor-social.svg`;
const socialImageAlt = "Module Federation Doctor icon";

export default defineConfig({
  root: path.join(docsAppDir, "docs"),
  llms: true,
  title: "Module Federation Doctor",
  description: "Diagnostics for Vite, Rspack, Rsbuild, and Webpack federation projects",
  icon: siteIcon,
  logo: {
    light: "/doctor-logo.svg",
    dark: "/doctor-logo-white.svg",
  },
  outDir: "doc_build",
  head: [
    ["meta", { property: "og:site_name", content: "Module Federation Doctor" }],
    ["meta", { property: "og:image", content: socialImageUrl }],
    ["meta", { property: "og:image:type", content: "image/svg+xml" }],
    ["meta", { property: "og:image:width", content: "1200" }],
    ["meta", { property: "og:image:height", content: "630" }],
    ["meta", { property: "og:image:alt", content: socialImageAlt }],
    ["meta", { name: "twitter:card", content: "summary_large_image" }],
    ["meta", { name: "twitter:image", content: socialImageUrl }],
    ["meta", { name: "twitter:image:alt", content: socialImageAlt }],
  ],
  markdown: {
    link: {
      checkDeadLinks: true,
    },
  },
  themeConfig: {
    editLink: {
      docRepoBaseUrl:
        "https://github.com/tonoizer/module-federation-doctor/tree/main/apps/docs/docs",
    },
    socialLinks: [
      {
        icon: "github",
        mode: "link",
        content: "https://github.com/tonoizer/module-federation-doctor",
      },
      {
        icon: "discord",
        mode: "link",
        content: "https://discord.gg/T8c6yAxkbv",
      },
    ],
  },
  builderConfig: {
    resolve: {
      alias: {
        "@site": path.resolve(docsAppDir),
        "@docs": path.join(docsAppDir, "docs"),
        "@public": path.join(docsAppDir, "docs/public"),
      },
    },
  },
});
