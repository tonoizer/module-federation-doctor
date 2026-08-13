import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@rspress/core";

const docsAppDir = path.dirname(fileURLToPath(import.meta.url));
// Vercel serves the canonical custom domain at the root. GitHub Pages overrides
// DOCS_BASE for its repository-path fallback build. Terminal/SARIF rule links
// use the same canonical origin via DOCTOR_DOCS_ORIGIN in src/reporters.ts.
const base = process.env.DOCS_BASE || "/";
const siteOrigin = (process.env.SITE_ORIGIN || "https://mfdoctor.kevinbeier.com").replace(
  /\/$/,
  "",
);
const siteIcon = "/module-federation-doctor-mark.svg";
const socialImageUrl = `${siteOrigin}/doctor-social.svg`;
const socialImageAlt = "Module Federation Doctor icon";

const guideSidebar = [
  {
    sectionHeaderText: "Guides",
  },
  {
    text: "Getting started",
    items: [
      { text: "Setup", link: "/setup" },
      { text: "CLI and CI", link: "/cli" },
      { text: "Production readiness", link: "/production-readiness" },
    ],
  },
  {
    text: "Configuration",
    collapsible: true,
    collapsed: true,
    items: [
      { text: "Configuration audit", link: "/configuration-audit" },
      { text: "Vite integration", link: "/vite-integration" },
      { text: "Monorepos", link: "/monorepos" },
      { text: "Custom rules", link: "/custom-rules" },
    ],
  },
  {
    text: "Governance",
    collapsible: true,
    collapsed: true,
    items: [
      { text: "Suppressions", link: "/suppressions" },
      { text: "Fingerprint baselines", link: "/baselines" },
      { text: "Policy packs", link: "/policy-packs" },
      { text: "Evidence-aware rules", link: "/evidence-aware-rules" },
    ],
  },
];

const exampleSidebar = [
  { sectionHeaderText: "Examples" },
  { text: "Overview", link: "/examples" },
  { text: "Mixed federation", link: "/mixed-example" },
  { text: "Mixed federation issues", link: "/mixed-issues-example" },
  { text: "Nested federation", link: "/nested-example" },
  { text: "Standalone findings", link: "/standalone-findings" },
  { text: "One-rule showcase", link: "/showcase" },
];

const referenceSidebar = [
  { sectionHeaderText: "Reference" },
  { text: "Compatibility", link: "/compatibility" },
  { text: "Capabilities", link: "/capabilities" },
  { text: "Runtime and manifests", link: "/runtime-manifests" },
  { text: "Runtime capture", link: "/runtime-capture" },
  { text: "Report schemas", link: "/report-schemas" },
  { text: "Performance", link: "/performance" },
  { text: "Security and privacy", link: "/security" },
  { text: "Limitations", link: "/limitations" },
];

const projectSidebar = [
  { sectionHeaderText: "Project" },
  { text: "Contributing", link: "/contributing" },
  { text: "Releasing", link: "/releasing" },
  { text: "Source map", link: "/sources" },
  { text: "Inspiration", link: "/inspiration" },
  {
    text: "Architecture decisions",
    collapsible: true,
    collapsed: true,
    items: [{ text: "Plugin and CLI", link: "/adr/hybrid-plugin-cli" }],
  },
];

const ruleCategoryOrder = [
  "config",
  "shared",
  "bridge",
  "ssr",
  "artifact",
  "reliability",
  "runtime",
  "runtime-plugins",
  "federation",
  "performance",
  "vite",
  "security",
  "doctor",
];

const ruleLabels: Record<string, string> = {
  config: "Config",
  shared: "Shared",
  bridge: "Bridge",
  ssr: "SSR",
  artifact: "Artifact",
  reliability: "Reliability",
  runtime: "Runtime",
  "runtime-plugins": "Runtime plugins",
  federation: "Federation",
  performance: "Performance",
  vite: "Vite",
  security: "Security",
  doctor: "Doctor",
};

const rulesRoot = path.join(docsAppDir, "docs", "rules");
const rulesSidebar = [
  { sectionHeaderText: "Rules" },
  { text: "Overview", link: "/rules/" },
  ...ruleCategoryOrder.map((category) => ({
    text: ruleLabels[category]!,
    collapsible: true,
    collapsed: true,
    items: fs
      .readdirSync(path.join(rulesRoot, category), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => entry.name.slice(0, -3))
      .sort((a, b) => a.localeCompare(b))
      .map((rule) => ({ text: rule, link: `/rules/${category}/${rule}` })),
  })),
];

const sidebar = {
  "/rules/": rulesSidebar,
  "/examples": exampleSidebar,
  "/mixed-example": exampleSidebar,
  "/mixed-issues-example": exampleSidebar,
  "/nested-example": exampleSidebar,
  "/standalone-findings": exampleSidebar,
  "/showcase": exampleSidebar,
  "/compatibility": referenceSidebar,
  "/capabilities": referenceSidebar,
  "/runtime-manifests": referenceSidebar,
  "/runtime-capture": referenceSidebar,
  "/report-schemas": referenceSidebar,
  "/performance": referenceSidebar,
  "/security": referenceSidebar,
  "/limitations": referenceSidebar,
  "/contributing": projectSidebar,
  "/releasing": projectSidebar,
  "/sources": projectSidebar,
  "/inspiration": projectSidebar,
  "/adr/": projectSidebar,
  "/": guideSidebar,
};

export default defineConfig({
  root: path.join(docsAppDir, "docs"),
  base,
  siteOrigin,
  llms: true,
  title: "Module Federation Doctor",
  description: "Diagnostics for Vite, Rspack, Rsbuild, Webpack, and Modern.js federation projects",
  icon: siteIcon,
  logo: {
    light: "/module-federation-doctor-mark.svg",
    dark: "/module-federation-doctor-mark.svg",
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
    nav: [
      {
        text: "Guides",
        link: "/setup",
        activeMatch:
          "^/(setup|cli|production-readiness|configuration-audit|vite-integration|monorepos|custom-rules|suppressions|baselines|policy-packs|evidence-aware-rules)",
      },
      {
        text: "Rules",
        link: "/rules/",
        activeMatch: "^/rules/",
      },
      {
        text: "Examples",
        link: "/examples",
        activeMatch:
          "^/(examples|mixed-example|mixed-issues-example|nested-example|standalone-findings|showcase)",
      },
      {
        text: "More",
        items: [
          { text: "Compatibility", link: "/compatibility" },
          { text: "Report schemas", link: "/report-schemas" },
          { text: "Contributing", link: "/contributing" },
          {
            text: "Module Federation",
            link: "https://module-federation.io/",
          },
        ],
      },
    ],
    sidebar,
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
