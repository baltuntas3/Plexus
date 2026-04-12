import { BraidGraph } from "../braid-graph.js";
import { DomainError } from "../../errors/domain-error.js";

describe("BraidGraph.parse", () => {
  it("parses a minimal valid graph", () => {
    const code = `flowchart TD;
A[Start] --> B[End];`;
    const graph = BraidGraph.parse(code);
    expect(graph.nodeCount).toBe(2);
    expect(graph.edgeCount).toBe(1);
    expect(graph.nodes.find((n) => n.id === "A")?.label).toBe("Start");
    expect(graph.edges[0]).toEqual({ from: "A", to: "B", label: null });
  });

  it("parses multi-line graphs with multiple edges", () => {
    const code = `flowchart TD;
A[Read request] --> B[Identify constraints];
B --> C[Draft response];
C --> D[Check: length <= 250 words];`;
    const graph = BraidGraph.parse(code);
    expect(graph.nodeCount).toBe(4);
    expect(graph.edgeCount).toBe(3);
  });

  it("parses quoted edge labels", () => {
    const code = `flowchart TD;
A[Start] -- "If text > 300 words" --> B[Truncate];`;
    const graph = BraidGraph.parse(code);
    expect(graph.edges.length).toBeGreaterThanOrEqual(1);
    const labeled = graph.edges.find((e) => e.label === "If text > 300 words");
    expect(labeled).toBeDefined();
    expect(labeled?.from).toBe("A");
    expect(labeled?.to).toBe("B");
  });

  it("rejects empty input", () => {
    expect(() => BraidGraph.parse("")).toThrow(DomainError);
  });

  it("rejects input without flowchart TD header", () => {
    expect(() => BraidGraph.parse("A --> B;")).toThrow(DomainError);
  });

  it("rejects header-only graphs with no nodes", () => {
    expect(() => BraidGraph.parse("flowchart TD;")).toThrow(DomainError);
  });

  it("accepts 'graph TD' header as alternative", () => {
    const code = `graph TD;
A[X] --> B[Y];`;
    const graph = BraidGraph.parse(code);
    expect(graph.nodeCount).toBe(2);
  });

  it("parses diamond decision nodes using {...}", () => {
    const code = `flowchart TD;
A[Identify inquiry] --> B{Billing or Technical?};
B -- "Billing" --> C[Check account];
B -- "Technical" --> D[Identify product area];`;
    const graph = BraidGraph.parse(code);
    expect(graph.nodeCount).toBe(4);
    expect(graph.nodes.find((n) => n.id === "B")?.label).toBe("Billing or Technical?");
    expect(graph.edges.length).toBeGreaterThanOrEqual(3);
    const labeled = graph.edges.filter((e) => e.label === "Billing" || e.label === "Technical");
    expect(labeled.length).toBe(2);
  });

  it("parses edges whose source or target is a diamond node", () => {
    const code = `flowchart TD;
A{Decide} --> B[Do A];
A --> C{Another decision};
C --> D[Done];`;
    const graph = BraidGraph.parse(code);
    expect(graph.nodeCount).toBe(4);
    expect(graph.edges.find((e) => e.from === "A" && e.to === "B")).toBeDefined();
    expect(graph.edges.find((e) => e.from === "C" && e.to === "D")).toBeDefined();
  });
});
