import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const fixture = JSON.parse(
  await fs.readFile(path.join(root, "fixtures/semantic-graph/mixed-v1-v2.json"), "utf8"),
);
const api = await import(path.join(root, "dist/index.js"));

const graph = api.buildSemanticGraph(fixture);
assert.equal(graph.schemaVersion, 1, "semantic graph schema must be v1");
assert.equal(
  graph.nodes.filter((node) => node.kind !== "legacy-project").length,
  fixture.identities.length,
  "all V2 identities must remain semantic nodes",
);
assert.equal(
  graph.legacyProjection.projects.length,
  1,
  "same-named legacy projects must share one explicit projection",
);
assert.equal(graph.legacyProjection.projects[0].ambiguous, true);
assert.equal(graph.nodes.find((node) => node.kind === "legacy-project")?.ambiguous, true);
assert.equal(graph.edges.length, 1);
assert.equal(graph.coverage[0]?.state, "complete");

const scoped = api.querySemanticGraph(graph, {
  edgeKind: "producer",
  scope: { target: "browser" },
});
assert.equal(scoped.edges.length, 1, "scoped capability query must return the browser edge");
assert.equal(scoped.coverage.length, 1, "scoped capability query must return coverage");

console.log("Semantic graph fixture and dist consumer check passed.");
