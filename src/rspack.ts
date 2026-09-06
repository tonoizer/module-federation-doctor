import { rspackDoctor } from "./plugin.js";

/** Rspack plugin factory — register next to `ModuleFederationPlugin` / `RspackModuleFederationPlugin`. */
export const moduleFederationDoctorPlugin = rspackDoctor.rspack;

export default moduleFederationDoctorPlugin;
