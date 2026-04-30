import { BraidGraph } from "../braid-graph.js";
import { DomainError } from "../../errors/domain-error.js";

const minimal = (): BraidGraph =>
  BraidGraph.parse(
    [
      "flowchart TD;",
      "  A[Start];",
      "  B{Decide?};",
      "  C[Verify];",
      "  A --> B;",
      `  B -- "yes" --> C;`,
    ].join("\n"),
  );

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

  it("captures node kind (step vs decision) for round-tripping", () => {
    const code = `flowchart TD;
A[Start];
B{Decide};`;
    const graph = BraidGraph.parse(code);
    expect(graph.nodes.find((n) => n.id === "A")?.kind).toBe("step");
    expect(graph.nodes.find((n) => n.id === "B")?.kind).toBe("decision");
  });
});

describe("BraidGraph.renameNode", () => {
  it("returns a new graph with the updated label and re-serialised mermaid", () => {
    const g = minimal();
    const next = g.renameNode("A", "Begin");
    expect(next.nodes.find((n) => n.id === "A")?.label).toBe("Begin");
    // Original graph is unchanged (immutability).
    expect(g.nodes.find((n) => n.id === "A")?.label).toBe("Start");
    expect(next.mermaidCode).toContain("A[Begin]");
  });

  it("rejects renaming a node that does not exist", () => {
    expect(() => minimal().renameNode("Z", "x")).toThrow(DomainError);
  });

  it("rejects empty labels", () => {
    expect(() => minimal().renameNode("A", "   ")).toThrow(DomainError);
  });
});

describe("BraidGraph.addNode", () => {
  it("appends a sequential N{n} node id and emits valid mermaid", () => {
    const g = minimal();
    const out = g.addNode("Plan", "step");
    expect(out.nodeId).toBe("N1");
    expect(out.graph.nodes).toHaveLength(g.nodes.length + 1);
    expect(out.graph.mermaidCode).toContain("N1[Plan]");
  });

  it("emits diamond shape for decision nodes", () => {
    const out = minimal().addNode("Continue?", "decision");
    expect(out.graph.mermaidCode).toContain("N1{Continue?}");
  });

  it("skips ids already in use when generating the next sequence number", () => {
    const seeded = BraidGraph.parse("flowchart TD;\n  N1[X];\n");
    const out = seeded.addNode("Y", "step");
    expect(out.nodeId).toBe("N2");
  });
});

describe("BraidGraph.removeNode", () => {
  it("removes the node and cascades through every edge that touched it", () => {
    const g = minimal();
    const next = g.removeNode("B");
    expect(next.nodes.find((n) => n.id === "B")).toBeUndefined();
    expect(next.edges.find((e) => e.from === "B" || e.to === "B")).toBeUndefined();
  });

  it("rejects removing a node that does not exist", () => {
    expect(() => minimal().removeNode("Z")).toThrow(DomainError);
  });

  it("rejects removing the only remaining node", () => {
    const single = BraidGraph.parse("flowchart TD;\n  A[Solo];\n");
    expect(() => single.removeNode("A")).toThrow(DomainError);
  });
});

describe("BraidGraph.addEdge", () => {
  it("adds an edge and re-serialises mermaid", () => {
    const g = minimal();
    const next = g.addEdge("A", "C", null);
    expect(next.edges.some((e) => e.from === "A" && e.to === "C")).toBe(true);
    expect(next.mermaidCode).toContain("A --> C");
  });

  it("rejects edges referencing missing nodes", () => {
    expect(() => minimal().addEdge("A", "Z", null)).toThrow(DomainError);
    expect(() => minimal().addEdge("Z", "A", null)).toThrow(DomainError);
  });

  it("rejects exact duplicate edges (same from/to/label)", () => {
    const g = minimal();
    expect(() => g.addEdge("A", "B", null)).toThrow(DomainError);
  });

  it("normalises empty/whitespace labels to null so duplicate detection is robust", () => {
    const g = minimal();
    expect(() => g.addEdge("A", "B", "   ")).toThrow(/already exists/);
  });
});

describe("BraidGraph.removeEdge / relabelEdge", () => {
  it("removes an edge by exact (from,to,label) match", () => {
    const g = minimal();
    const next = g.removeEdge("B", "C", "yes");
    expect(next.edges.some((e) => e.from === "B" && e.to === "C")).toBe(false);
  });

  it("rejects removing an edge that does not match by label", () => {
    expect(() => minimal().removeEdge("B", "C", "no")).toThrow(DomainError);
  });

  it("relabels an edge in place", () => {
    const next = minimal().relabelEdge("B", "C", "yes", "approved");
    expect(next.edges.find((e) => e.from === "B")?.label).toBe("approved");
  });

  it("is a no-op when relabel old == new", () => {
    const g = minimal();
    const next = g.relabelEdge("B", "C", "yes", "yes");
    expect(next).toBe(g);
  });

  it("rejects a relabel that would collide with an existing edge", () => {
    // Two parallel edges B → C with different labels; relabel one to
    // match the other → conflict.
    const seeded = BraidGraph.parse(
      [
        "flowchart TD;",
        "  A[Start];",
        "  B{Decide?};",
        "  C[End];",
        "  A --> B;",
        `  B -- "yes" --> C;`,
        `  B -- "no" --> C;`,
      ].join("\n"),
    );
    expect(() => seeded.relabelEdge("B", "C", "no", "yes")).toThrow(/already exists/);
  });
});

describe("BraidGraph label validation (fail-fast at boundary)", () => {
  it("rejects step-node labels containing the `[]` mermaid delimiter chars", () => {
    const g = minimal();
    // A is a step node in `minimal()`; brackets in step labels would
    // collide with the surrounding `[...]` delimiter on serialise.
    expect(() => g.renameNode("A", "foo [bar]")).toThrow(/bracket/);
    expect(() => g.addNode("draft]", "step")).toThrow(/bracket/);
  });

  it("rejects decision-node labels containing the `{}` mermaid delimiter chars", () => {
    const g = minimal();
    // B is a decision node; braces inside a decision label would
    // collide with `{...}` delimiters and the `{{var}}` template
    // syntax convention (which is for step nodes).
    expect(() => g.renameNode("B", "is {x} > 0?")).toThrow(/brace/);
    expect(() => g.addNode("Decide {x}?", "decision")).toThrow(/brace/);
  });

  it("allows `{{var}}` template references in step-node labels", () => {
    // The whole point of variable autocomplete: step-node labels can
    // carry `{{name}}` placeholders without tripping the validation,
    // because the surrounding `[...]` delimiter survives even with
    // braces in the inner content.
    const g = minimal();
    const renamed = g.renameNode("A", "Process {{topic}}");
    expect(renamed.nodes.find((n) => n.id === "A")?.label).toBe(
      "Process {{topic}}",
    );
    const added = g.addNode("Use {{tone}} tone", "step");
    expect(
      added.graph.nodes.find((n) => n.id === added.nodeId)?.label,
    ).toBe("Use {{tone}} tone");
  });

  it("rejects edge labels containing double-quote characters", () => {
    const g = minimal();
    expect(() => g.addEdge("A", "C", 'say "hi"')).toThrow(/double-quote/);
    expect(() => g.relabelEdge("B", "C", "yes", 'say "no"')).toThrow(/double-quote/);
  });

  it("preserves valid node labels round-trip through serialise+parse", () => {
    const before = minimal();
    const after = BraidGraph.parse(before.mermaidCode);
    expect(after.nodes.map((n) => n.label).sort()).toEqual(
      before.nodes.map((n) => n.label).sort(),
    );
    expect(after.edges.find((e) => e.from === "B" && e.to === "C")?.label).toBe(
      "yes",
    );
  });
});
