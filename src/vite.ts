import { viteDoctor } from "./plugin.js";

/** Vite plugin — register next to `federation` from `@module-federation/vite`. */
export const federationDoctor = viteDoctor.vite;

/** @deprecated Use `federationDoctor`. */
export const doctor = federationDoctor;

export default federationDoctor;
