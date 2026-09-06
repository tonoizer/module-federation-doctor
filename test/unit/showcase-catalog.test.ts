import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

type ShowcaseLeaf = {
  leaf: string;
  ruleId?: string;
  expectNoFindings: boolean;
};

function showcaseLeavesFromDemo(source: string): ShowcaseLeaf[] {
  const start = source.indexOf("const cases = [");
  const end = source.indexOf("\n];", start);
  if (start < 0 || end < 0) {
    throw new Error("could not find demo-showcase cases array");
  }
  const body = source.slice(start, end);
  return [...body.matchAll(/\{[\s\S]*?\}/g)].map((match) => {
    const block = match[0];
    const dir = block.match(/dir:\s*"([^"]+)"/)?.[1];
    const pattern = block.match(/pattern:\s*"([^"]+)"/)?.[1];
    const location = dir ?? pattern;
    if (!location) {
      throw new Error(`demo-showcase case is missing dir/pattern:\n${block}`);
    }
    const leaf = location.replace(/^examples\/showcase\//, "").replace(/\/\*\.project\.json$/, "");
    return {
      leaf,
      ruleId: block.match(/ruleId:\s*"([^"]+)"/)?.[1],
      expectNoFindings: /expectNoFindings:\s*true/.test(block),
    };
  });
}

function showcaseLeavesFromReadme(source: string): Array<{ leaf: string; row: string }> {
  return source.split("\n").flatMap((line) => {
    const match = line.match(/^\| `([^`]+)`\s+\|/);
    return match ? [{ leaf: match[1], row: line }] : [];
  });
}

describe("showcase catalog", () => {
  it("lists every demo-showcase leaf in examples/showcase/README.md", async () => {
    const [demoSource, readmeSource] = await Promise.all([
      readFile(path.join(root, "scripts/demo-showcase.mjs"), "utf8"),
      readFile(path.join(root, "examples/showcase/README.md"), "utf8"),
    ]);
    const demoLeaves = showcaseLeavesFromDemo(demoSource);
    const readmeLeaves = showcaseLeavesFromReadme(readmeSource);

    expect(demoLeaves.map((item) => item.leaf)).toEqual(readmeLeaves.map((item) => item.leaf));

    for (const [index, item] of demoLeaves.entries()) {
      const row = readmeLeaves[index]?.row ?? "";
      if (item.expectNoFindings) {
        expect(row, item.leaf).toMatch(/_\(none\)_|no findings/);
        continue;
      }
      expect(item.ruleId, item.leaf).toEqual(expect.any(String));
      expect(row, item.leaf).toContain(`\`${item.ruleId}\``);
    }
  });
});
