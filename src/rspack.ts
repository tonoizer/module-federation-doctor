import { rspackDoctor } from "./plugin.js";

/** Rspack plugin factory — register next to `ModuleFederationPlugin`. */
export const moduleFederationDoctorPlugin = rspackDoctor.rspack;

/** @deprecated Use `moduleFederationDoctorPlugin`. */
export const doctor = moduleFederationDoctorPlugin;

export default moduleFederationDoctorPlugin;
