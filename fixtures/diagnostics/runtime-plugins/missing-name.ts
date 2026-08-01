/** Fixture: factory returns hooks without a usable `name`. */
export default function missingNamePlugin() {
  return {
    createScript() {
      return undefined;
    },
  };
}
