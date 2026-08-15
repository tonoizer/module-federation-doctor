/**
 * Thin Node entry for `vp run schema:check` / `pack:check`.
 * Implementation lives in the typed helper (unit tests import that directly).
 */
import { runSchemaContractChecks } from "../test/helpers/schema-contract.ts";

await runSchemaContractChecks();
process.stdout.write("Schema contract checks passed.\n");
