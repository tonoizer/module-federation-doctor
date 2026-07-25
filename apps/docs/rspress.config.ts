import { defineConfig } from "rspress/config";

export default defineConfig({
  root: "docs",
  title: "Module Federation Doctor",
  description: "Diagnostics for Vite, Rspack, and Rsbuild federation projects",
  outDir: "doc_build",
  themeConfig: {
    nav: [{ text: "Guide", link: "/" }],
    sidebar: {
      "/": [
        { text: "Introduction", link: "/" },
        { text: "Setup", link: "/setup" },
        { text: "CLI and CI", link: "/cli" },
        { text: "Mixed example", link: "/mixed-example" },
        { text: "Rules", link: "/rules/" },
        { text: "Custom rules", link: "/custom-rules" },
        { text: "Report schemas", link: "/report-schemas" },
        { text: "Production readiness", link: "/production-readiness" },
        { text: "Configuration audit", link: "/configuration-audit" },
        { text: "Performance", link: "/performance" },
        { text: "Runtime and manifests", link: "/runtime-manifests" },
        { text: "Vite integration", link: "/vite-integration" },
        { text: "UI and docs design", link: "/ui-and-docs" },
        { text: "Monorepos", link: "/monorepos" },
        { text: "Security and privacy", link: "/security" },
        { text: "Capabilities", link: "/capabilities" },
        { text: "Limitations", link: "/limitations" },
        { text: "Contributing", link: "/contributing" },
        { text: "Releasing", link: "/releasing" },
        { text: "Inspiration", link: "/inspiration" },
      ],
    },
  },
});
