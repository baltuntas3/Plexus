import { BraidGraphLayout } from "../braid-graph-layout.js";

describe("BraidGraphLayout", () => {
  it("constructs from a positions array and round-trips through primitives", () => {
    const layout = BraidGraphLayout.fromPositions([
      { nodeId: "A", x: 100, y: 200 },
      { nodeId: "B", x: -50, y: 0 },
    ]);
    expect(layout.size).toBe(2);
    expect(layout.positionOf("A")).toEqual({ x: 100, y: 200 });

    const round = BraidGraphLayout.fromPrimitives(layout.toPrimitives());
    expect(round.equals(layout)).toBe(true);
  });

  it("rejects invalid nodeIds", () => {
    expect(() =>
      BraidGraphLayout.fromPositions([{ nodeId: "1bad", x: 0, y: 0 }]),
    ).toThrow(/Invalid layout nodeId/);
  });

  it("rejects non-finite coordinates", () => {
    expect(() =>
      BraidGraphLayout.fromPositions([{ nodeId: "A", x: NaN, y: 0 }]),
    ).toThrow(/finite/);
    expect(() =>
      BraidGraphLayout.fromPositions([{ nodeId: "A", x: Infinity, y: 0 }]),
    ).toThrow(/finite/);
  });

  it("rejects out-of-bound coordinates (sanity ceiling)", () => {
    expect(() =>
      BraidGraphLayout.fromPositions([{ nodeId: "A", x: 60_000, y: 0 }]),
    ).toThrow(/exceeds/);
  });

  it("rejects duplicate nodeIds in the positions array", () => {
    expect(() =>
      BraidGraphLayout.fromPositions([
        { nodeId: "A", x: 0, y: 0 },
        { nodeId: "A", x: 1, y: 1 },
      ]),
    ).toThrow(/Duplicate/);
  });

  it("equals is order-independent", () => {
    const a = BraidGraphLayout.fromPositions([
      { nodeId: "A", x: 0, y: 0 },
      { nodeId: "B", x: 1, y: 1 },
    ]);
    const b = BraidGraphLayout.fromPositions([
      { nodeId: "B", x: 1, y: 1 },
      { nodeId: "A", x: 0, y: 0 },
    ]);
    expect(a.equals(b)).toBe(true);
  });

  it("equals returns false on different positions for the same node", () => {
    const a = BraidGraphLayout.fromPositions([{ nodeId: "A", x: 0, y: 0 }]);
    const b = BraidGraphLayout.fromPositions([{ nodeId: "A", x: 1, y: 0 }]);
    expect(a.equals(b)).toBe(false);
  });
});
