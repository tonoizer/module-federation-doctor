import { rsbuildDoctor } from "./plugin.js";

/** Rsbuild plugin — register next to `pluginModuleFederation`. */
export const pluginModuleFederationDoctor = rsbuildDoctor.rsbuild;

export default pluginModuleFederationDoctor;
