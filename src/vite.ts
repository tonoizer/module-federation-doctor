import { viteDoctor } from "./plugin.js";
import type { DoctorOptions } from "./types.js";

/**
 * Version-neutral Vite plugin surface. Keeping the public type structural
 * avoids coupling consumers to the Vite peer instance used by Unplugin while
 * retaining everything Vite requires to register the plugin.
 */
export interface ViteDoctorPlugin {
  name: string;
}

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
export function federationDoctor(options?: DoctorOptions): ViteDoctorPlugin {
  return viteDoctor.vite(options) as unknown as ViteDoctorPlugin;
}

/** @deprecated Use `federationDoctor`. */
export const doctor = federationDoctor;

export default federationDoctor;
