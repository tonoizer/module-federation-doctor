import { webpackDoctor } from "./plugin.js";

/** Webpack plugin factory — register next to `ModuleFederationPlugin`. */
export const moduleFederationDoctorPlugin = webpackDoctor.webpack;

/** @deprecated Use `moduleFederationDoctorPlugin`. */
export const doctor = moduleFederationDoctorPlugin;

export default moduleFederationDoctorPlugin;
