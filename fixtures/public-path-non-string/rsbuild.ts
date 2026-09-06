/** Rsbuild/Rspack `output.publicPath` that is not a string. */
export const rsbuildNonStringPublicPath = (): string => "/";

export const rsbuildNormalizedConfig = {
  output: {
    publicPath: rsbuildNonStringPublicPath,
  },
};
