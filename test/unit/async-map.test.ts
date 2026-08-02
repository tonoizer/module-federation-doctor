import { describe, expect, it } from "vitest";
import { mapBounded } from "../../src/async-map.js";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("mapBounded", () => {
  it("limits active work to eight and preserves input order", async () => {
    let active = 0;
    let maxActive = 0;

    const result = await mapBounded(
      Array.from({ length: 24 }, (_, index) => index),
      async (value) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await delay((24 - value) % 5);
        active -= 1;
        return value * 2;
      },
    );

    expect(maxActive).toBeLessThanOrEqual(8);
    expect(result).toEqual(Array.from({ length: 24 }, (_, index) => index * 2));
  });

  it("propagates the mapper error unchanged", async () => {
    const expected = new Error("delayed worker failed");

    await expect(
      mapBounded([0, 1, 2, 3], async (value) => {
        await delay(value === 2 ? 2 : 0);
        if (value === 2) throw expected;
        return value;
      }),
    ).rejects.toBe(expected);
  });
});
