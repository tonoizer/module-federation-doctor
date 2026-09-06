import { webpackDoctor } from "./plugin.js";

/** Webpack plugin factory — register next to `ModuleFederationPlugin`. */
export const ModuleFederationDoctorPlugin = webpackDoctor.webpack;

export default ModuleFederationDoctorPlugin;
