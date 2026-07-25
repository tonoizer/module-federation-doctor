import { rsbuildDoctor } from "./plugin.js";

/** Rsbuild plugin — register next to `pluginModuleFederation`. */
export const pluginModuleFederationDoctor = rsbuildDoctor.rsbuild;

/** @deprecated Use `pluginModuleFederationDoctor`. */
export const doctor = pluginModuleFederationDoctor;

export default pluginModuleFederationDoctor;
