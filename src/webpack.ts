import { webpackDoctor } from "./plugin.js";

/** Webpack plugin factory — register next to `ModuleFederationPlugin`. */
export const ModuleFederationDoctorPlugin = webpackDoctor.webpack;

/** @deprecated Use `ModuleFederationDoctorPlugin`. */
export const moduleFederationDoctorPlugin = ModuleFederationDoctorPlugin;

/** @deprecated Use `ModuleFederationDoctorPlugin`. */
export const doctor = ModuleFederationDoctorPlugin;

export default ModuleFederationDoctorPlugin;
