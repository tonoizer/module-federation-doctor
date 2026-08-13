import { viteDoctor } from "./plugin.js";

/**
 * Vite-family MFDoctor plugin — register next to `federation` from
 * `@module-federation/vite`.
 *
 * Supported entry path for classic Vite, Rolldown-integrated Vite
 * (`rolldown-vite` / Vite 8+), and Vite Plus (`vite-plus` /
 * `@voidzero-dev/vite-plus-core`). MFDoctor detects the emit engine and records
 * lifecycle capabilities; use the same `mfOptions` object as the MF plugin.
 *
 * Direct Rolldown without `@module-federation/vite` is unsupported.
 */
export const federationDoctor = viteDoctor.vite;

/** @deprecated Use `federationDoctor`. */
export const doctor = federationDoctor;

export default federationDoctor;
