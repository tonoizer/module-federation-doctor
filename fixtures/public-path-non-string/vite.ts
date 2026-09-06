/** Vite MF `publicPath` that is not a string — skips upstream manifest generation. */
export const viteNonStringPublicPath = (): string => "/";

export const viteFederationOptions = {
  name: "public_path_non_string",
  filename: "remoteEntry.js",
  manifest: true,
  exposes: { "./Widget": "./src/Widget.ts" },
  shared: {},
  publicPath: viteNonStringPublicPath,
};
