// Meta-BRAID: the reasoning graph that drives BRAID generation.
//
// The BraidAgentExecutor traverses this graph, calling the LLM at each node,
// to produce a new BRAID from a classical prompt.
//
// This graph itself conforms to all 7 BRAID quality rules, making it a
// self-referential example of the format it generates.
//
// Rule compliance:
//   1. Node atomicity     — all labels ≤ 15 tokens
//   2. No answer leakage  — labels encode plan steps, not literal output
//   3. Deterministic branching — all branch edges carry explicit labels
//   4. Mutual exclusivity  — every decision has disjoint yes/no branches
//   5. Terminal verification loops — Q is the sole terminal (starts "Verify:");
//                                    H/J/L/N each have a back-edge on "no";
//                                    P forms the critic-revision outer loop
//   6. DAG structure       — acyclic except for the loops in rule 5
//   7. Reachability        — every node reachable from A
export const BRAID_AGENT_MERMAID = `flowchart TD;
  A[Parse: task type from input] --> B[Extract: constraints and goals];
  B --> C[Plan: list required reasoning steps];
  C --> D{Need branching logic?};
  D -- "yes" --> E[Design: decision diamonds with conditions];
  D -- "no" --> F[Design: linear flow with verify loops];
  E --> G[Draft: write Mermaid nodes and edges];
  F --> G;
  G --> H{Check: nodes atomic under 15 tokens?};
  H -- "no" --> I[Revise: split dense nodes];
  I --> H;
  H -- "yes" --> J{Check: no literal output in labels?};
  J -- "no" --> K[Revise: abstract labels to plan steps];
  K --> J;
  J -- "yes" --> L{Check: terminal verification loops present?};
  L -- "no" --> M[Add: Check or Verify terminals with fail loops];
  M --> L;
  L -- "yes" --> N{Check: all branch edges labeled?};
  N -- "no" --> O[Add: condition labels to branches];
  O --> N;
  N -- "yes" --> P[Critic: review complete BRAID against all 7 rules];
  P -- "no" --> G;
  P -- "yes" --> Q[Verify: final BRAID is valid Mermaid];`;
