import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Nav, type Sidebar } from "@rspress/core";
import { docsRelease } from "./docs-release.js";

const docsAppDir = path.dirname(fileURLToPath(import.meta.url));
// Vercel serves the canonical custom domain at the root. GitHub Pages overrides
// DOCS_BASE for its repository-path fallback build. Terminal/SARIF rule links
// use the same canonical origin via DOCTOR_DOCS_ORIGIN in src/reporters.ts.
const base = process.env.DOCS_BASE || "/";
const siteOrigin = (process.env.SITE_ORIGIN || "https://mfdoctor.kevinbeier.com").replace(
  /\/$/,
  "",
);
const siteIcon = "/mfdoctor-mark.svg";
const socialImageUrl = `${siteOrigin}/mfdoctor-social.svg`;
const socialImageAlt = "MFDoctor icon";

const guideSidebar = [
  { sectionHeaderText: "Guide" },
  {
    text: "Getting started",
    items: [
      { text: "Setup", link: "/setup" },
      { text: "CI", link: "/production-readiness" },
      { text: "Rules", link: "/rules/" },
      { text: "Limitations", link: "/limitations" },
    ],
  },
  {
    text: "Adoption",
    items: [
      { text: "Bundler integrations", link: "/integrations" },
      { text: "Monorepos", link: "/monorepos" },
    ],
  },
];

const configurationSidebar = [
  { sectionHeaderText: "Configuration" },
  { text: "Configuration audit", link: "/configuration-audit" },
  { text: "Vite integration", link: "/vite-integration" },
  { text: "Custom rules", link: "/custom-rules" },
  { text: "Evidence-aware rules", link: "/evidence-aware-rules" },
  {
    text: "Governance",
    collapsible: true,
    collapsed: true,
    items: [
      { text: "Suppressions", link: "/suppressions" },
      { text: "Fingerprint baselines", link: "/baselines" },
      { text: "Policy packs", link: "/policy-packs" },
    ],
  },
];

const cliSidebar = [
  { sectionHeaderText: "CLI" },
  { text: "Command reference", link: "/cli" },
  { text: "Agent loop", link: "/agent-loop" },
  { text: "CI", link: "/production-readiness" },
  { text: "Fingerprint baselines", link: "/baselines" },
  { text: "Observability → runtime", link: "/observability-runtime" },
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
  { text: "Capability matrix", link: "/capabilities" },
  { text: "Documentation lifecycle", link: "/docs-lifecycle" },
  { text: "Runtime and manifests", link: "/runtime-manifests" },
  { text: "Observability → runtime", link: "/observability-runtime" },
  { text: "Performance", link: "/performance" },
];

// 1.1.0+ additive library contracts for authors extending Doctor — not the
// host-team onboarding path (Setup / CI / Rules / Limitations).
const librarySidebar = [
  { sectionHeaderText: "Library / extension" },
  { text: "Identity, waivers, and graph", link: "/capabilities#library-contracts-110" },
  { text: "Report schemas", link: "/report-schemas" },
  { text: "Runtime capture", link: "/runtime-capture" },
  { text: "Public API surface", link: "/api" },
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
  doctor: "MFDoctor",
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
  "/docs-lifecycle": referenceSidebar,
  "/runtime-manifests": referenceSidebar,
  "/observability-runtime": cliSidebar,
  "/performance": referenceSidebar,
  "/api": librarySidebar,
  "/runtime-capture": librarySidebar,
  "/report-schemas": librarySidebar,
  "/cli": cliSidebar,
  "/agent-loop": cliSidebar,
  "/configuration-audit": configurationSidebar,
  "/vite-integration": configurationSidebar,
  "/custom-rules": configurationSidebar,
  "/evidence-aware-rules": configurationSidebar,
  "/suppressions": configurationSidebar,
  "/baselines": configurationSidebar,
  "/policy-packs": configurationSidebar,
  "/setup": guideSidebar,
  "/production-readiness": guideSidebar,
  "/limitations": guideSidebar,
  "/integrations": guideSidebar,
  "/monorepos": guideSidebar,
  "/": guideSidebar,
};

type MenuNode = {
  [key: string]: unknown;
  items?: MenuNode[];
  link?: string;
  activeMatch?: string;
  text?: string;
};

const nav: MenuNode[] = [
  {
    text: "Guide",
    link: "/setup",
    activeMatch: "^/(setup|integrations|monorepos|production-readiness|limitations)",
  },
  {
    text: "Configuration",
    link: "/configuration-audit",
    activeMatch:
      "^/(configuration-audit|vite-integration|custom-rules|evidence-aware-rules|suppressions|baselines|policy-packs)",
  },
  {
    text: "CLI",
    link: "/cli",
    activeMatch: "^/(cli|agent-loop|observability-runtime)",
  },
  {
    text: "Rules",
    link: "/rules/",
    activeMatch: "^/rules/",
  },
  {
    text: "Resources",
    items: [
      { text: "Examples", link: "/examples" },
      { text: "Compatibility", link: "/compatibility" },
      { text: "Limitations", link: "/limitations" },
      {
        text: "Library / extension",
        link: "/capabilities#library-contracts-110",
      },
      { text: `MFDoctor v${docsRelease.version}`, link: docsRelease.releaseUrl },
      {
        text: "Module Federation",
        link: "https://module-federation.io/",
      },
    ],
  },
];

const germanLabels: Record<string, string> = {
  Guide: "Anleitung",
  "Getting started": "Erste Schritte",
  Setup: "Einrichtung",
  CI: "CI",
  "Bundler integrations": "Bundler-Integrationen",
  Adoption: "Einführung",
  Monorepos: "Monorepos",
  "Production readiness": "Produktionsbereitschaft",
  Configuration: "Konfiguration",
  "Configuration audit": "Konfigurationsprüfung",
  "Vite integration": "Vite-Integration",
  "Custom rules": "Eigene Regeln",
  "Evidence-aware rules": "Evidenzbasierte Regeln",
  Governance: "Governance",
  Suppressions: "Unterdrückungen",
  "Fingerprint baselines": "Fingerprint-Baselines",
  "Policy packs": "Policy-Pakete",
  CLI: "CLI",
  "Command reference": "Befehlsreferenz",
  "Agent loop": "Agenten-Schleife",
  "Production and CI": "Produktion und CI",
  "Observability → runtime": "Observability → runtime",
  "Runtime capture": "Laufzeitaufzeichnung",
  "Report schemas": "Report-Schemas",
  Examples: "Beispiele",
  Overview: "Übersicht",
  "Mixed federation": "Gemischte Federation",
  "Mixed federation issues": "Probleme in gemischten Federations",
  "Nested federation": "Verschachtelte Federation",
  "Standalone findings": "Einzelbefunde",
  "One-rule showcase": "Ein-Regel-Schaukasten",
  Rules: "Regeln",
  Resources: "Ressourcen",
  Compatibility: "Kompatibilität",
  Capabilities: "Fähigkeiten",
  "Capability matrix": "Fähigkeitenmatrix",
  "Documentation lifecycle": "Lebenszyklus der Dokumentation",
  "Public API surface": "Öffentliche API-Oberfläche",
  "Runtime and manifests": "Laufzeit und Manifeste",
  Performance: "Leistung",
  Limitations: "Einschränkungen",
  "Library / extension": "Bibliothek / Erweiterung",
  "Identity, waivers, and graph": "Identity, Waivers und Graph",
  Config: "Konfiguration",
  Shared: "Shared",
  Reliability: "Zuverlässigkeit",
  Federation: "Federation",
  Artifact: "Artefakt",
  "Runtime plugins": "Laufzeit-Plugins",
  "Module Federation": "Module Federation",
};

function routePrefix(version: string, language: string) {
  const versionPart =
    docsRelease.multiVersion && version !== docsRelease.version ? `/${version}` : "";
  const languagePart = language === "en" ? "" : `/${language}`;
  return `${versionPart}${languagePart}`;
}

function prefixLink(link: string, prefix: string) {
  if (!link || prefix === "" || /^(?:https?:|mailto:|#)/.test(link)) return link;
  if (!link.startsWith("/")) return link;
  return `${prefix}${link}` || "/";
}

function prefixMenu(items: MenuNode[], prefix: string, localize: boolean): MenuNode[] {
  return items.map((item) => {
    const next: MenuNode = { ...item };
    if (typeof next.text === "string" && localize) next.text = germanLabels[next.text] ?? next.text;
    if (typeof next.link === "string") next.link = prefixLink(next.link, prefix);
    if (typeof next.activeMatch === "string" && prefix) {
      next.activeMatch = next.activeMatch.replace(/^\^\//, `^${prefix}/`);
    }
    if (Array.isArray(next.items)) next.items = prefixMenu(next.items, prefix, localize);
    return next;
  });
}

function prefixedSidebar(baseSidebar: Record<string, MenuNode[]>, language: string) {
  const result: Record<string, MenuNode[]> = {};
  for (const version of docsRelease.maintainedVersions) {
    const prefix = routePrefix(version, language);
    for (const [key, items] of Object.entries(baseSidebar)) {
      const sidebarKey = `${prefix}${key}` || "/";
      result[sidebarKey] = prefixMenu(items, prefix, language === "de");
    }
  }
  return result;
}

function versionedNav(language: string) {
  const values = Object.fromEntries(
    docsRelease.maintainedVersions.map((version) => [
      version,
      prefixMenu(nav, routePrefix(version, language), language === "de"),
    ]),
  );
  return docsRelease.multiVersion ? values : values[docsRelease.version]!;
}

const docsBuildRoot = path.join(docsAppDir, ".generated");
const englishNav = versionedNav("en") as unknown as Nav;
const germanNav = versionedNav("de") as unknown as Nav;
const englishSidebar = prefixedSidebar(sidebar, "en") as unknown as Sidebar;
const germanSidebar = prefixedSidebar(sidebar, "de") as unknown as Sidebar;

export default defineConfig({
  root: docsBuildRoot,
  base,
  siteOrigin,
  lang: "en",
  locales: [
    { lang: "en", label: "English" },
    { lang: "de", label: "Deutsch" },
  ],
  ...(docsRelease.multiVersion
    ? {
        multiVersion: {
          default: docsRelease.multiVersion.default,
          versions: [...docsRelease.multiVersion.versions],
        },
      }
    : {}),
  llms: true,
  title: "MFDoctor",
  description: "Diagnostics for Vite, Rspack, Rsbuild, Webpack, and Modern.js federation projects",
  icon: siteIcon,
  logo: {
    light: "/mfdoctor-mark.svg",
    dark: "/mfdoctor-mark.svg",
  },
  outDir: "doc_build",
  head: [
    ["meta", { property: "og:site_name", content: "MFDoctor" }],
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
    nav: englishNav,
    sidebar: englishSidebar,
    locales: [
      {
        lang: "de",
        label: "Deutsch",
        nav: germanNav,
        sidebar: germanSidebar,
      },
    ],
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
        icon: "x",
        mode: "link",
        content: "https://x.com/tonoizer",
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
