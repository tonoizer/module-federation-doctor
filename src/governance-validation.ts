import { IdentityValidationError } from "./identity.js";

const UNSAFE_VALUE =
  /(?:[A-Za-z]:[\\/]|\\\\|^\/|[a-z][a-z\d+.-]*:\/\/|[?&](?:token|sig|signature|expires|auth|authorization|password|secret|credential|session|key)(?:=|&|$))/i;
const VOLATILE_VALUE =
  /^(?:\d{10,13}|\d{4}-\d{2}-\d{2}(?:[Tt ]|$)|(?:process|session|tab|pid|sid)(?:[-_:]|$))/i;

/** Shared validation for portable governance rule and waiver values. */
export function assertSafeValue(value: string, label: string, maxLength: number): void {
  if (
    value.length === 0 ||
    value.length > maxLength ||
    UNSAFE_VALUE.test(value) ||
    VOLATILE_VALUE.test(value)
  )
    throw new IdentityValidationError(`${label} must be a bounded non-sensitive value.`);
}
