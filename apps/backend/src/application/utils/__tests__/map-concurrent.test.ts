import { mapConcurrent } from "../map-concurrent.js";

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("mapConcurrent", () => {
  it("returns an empty array for an empty input", async () => {
    const result = await mapConcurrent([], 4, async (x) => x);
    expect(result).toEqual([]);
  });

  it("preserves input order in the output even when items finish out of order", async () => {
    const items = [50, 10, 30, 5, 20];
    const result = await mapConcurrent(items, 3, async (delay, i) => {
      await tick(delay);
      return `${i}:${delay}`;
    });
    expect(result).toEqual(["0:50", "1:10", "2:30", "3:5", "4:20"]);
  });

  it("never exceeds the configured concurrency", async () => {
    let active = 0;
    let peak = 0;
    const items = Array.from({ length: 12 }, (_, i) => i);
    await mapConcurrent(items, 4, async () => {
      active += 1;
      peak = Math.max(peak, active);
      await tick(15);
      active -= 1;
    });
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });

  it("propagates the first failure and stops claiming new items", async () => {
    const processed: number[] = [];
    const items = [1, 2, 3, 4, 5, 6, 7, 8];

    await expect(
      mapConcurrent(items, 2, async (n) => {
        if (n === 3) throw new Error("boom");
        await tick(5);
        processed.push(n);
        return n;
      }),
    ).rejects.toThrow("boom");

    // After the failure, remaining items should not all run.
    expect(processed.length).toBeLessThan(items.length);
  });

  it("rejects an invalid concurrency limit", async () => {
    await expect(mapConcurrent([1], 0, async (x) => x)).rejects.toThrow(RangeError);
  });

  it("falls back to items.length when limit exceeds it", async () => {
    let active = 0;
    let peak = 0;
    await mapConcurrent([1, 2], 99, async () => {
      active += 1;
      peak = Math.max(peak, active);
      await tick(5);
      active -= 1;
    });
    expect(peak).toBe(2);
  });
});
