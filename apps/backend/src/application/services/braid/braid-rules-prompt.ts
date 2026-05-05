interface BraidRulePromptDefinition {
  id: string;
  title: string;
  compact: string;
  detail: string;
}

const BRAID_RULES: BraidRulePromptDefinition[] = [
  {
    id: "node-atomicity",
    title: "NODE ATOMICITY",
    compact:
      "Each node = one discrete reasoning step, <=15 tokens. No dense multi-action nodes.",
    detail: [
      "Each node is ONE discrete reasoning step (observation, decision, or action). Keep labels under ~15 tokens. Prefer many small nodes over one dense node.",
      "Good:",
      "  A[Extract user intent]",
      "  B[Check account status]",
      "  C[Draft response: empathetic tone]",
      "Bad:",
      "  A[Understand the user's question and figure out what they need and write an appropriate response]",
    ].join("\n   "),
  },
  {
    id: "answer-leakage",
    title: "NO ANSWER LEAKAGE",
    compact: "Nodes encode the PLAN, never the literal output text.",
    detail: [
      "Nodes encode the PLAN, not the literal output text. Never put quoted sentences or drafted prose inside a node label.",
      "Good:",
      "  D[Draft intro: acknowledge then pivot]",
      "Bad:",
      "  D[Write: \"Dear Team, I regret to inform you...\"]",
    ].join("\n   "),
  },
  {
    id: "deterministic-branching",
    title: "DETERMINISTIC BRANCHING",
    compact:
      "Every fork uses a diamond node {Question?} with labeled edges on every branch.",
    detail: [
      "When a node has two or more outgoing edges, every edge MUST carry an explicit condition label. Use diamond nodes for decision points.",
      "Format:",
      "  D{Billing or Technical?}",
      "  D -- \"Billing\" --> E[Check account]",
      "  D -- \"Technical\" --> F[Identify product area]",
    ].join("\n   "),
  },
  {
    id: "mutual-exclusivity",
    title: "MUTUAL EXCLUSIVITY",
    compact:
      "Branch conditions from the same node must be mutually exclusive and exhaustive.",
    detail:
      "Branch conditions from the same source must be mutually exclusive and collectively exhaustive. Never label two branches with the same or overlapping conditions.",
  },
  {
    id: "terminal-verification",
    title: "TERMINAL VERIFICATION LOOPS",
    compact:
      "Every terminal node must start with Check/Verify/Validate/Assert/Critic. At least one Check node must have a fail->revise->Check back-loop. Terminals like \"End\", \"Done\", \"Output\" are forbidden.",
    detail: [
      "THIS IS THE MOST IMPORTANT RULE. Read carefully.",
      "(a) EVERY terminal node (any node with zero outgoing edges) MUST be a verification node whose label starts with one of: \"Check:\", \"Verify:\", \"Validate:\", \"Assert:\", or \"Critic:\". No exceptions. A node like \"End\", \"Done\", \"Return response\", \"Output\", \"Final answer\" is NOT a verification node and is FORBIDDEN as a terminal.",
      "(b) Every branch of the flow must eventually reach a verification terminal. Do not leave any path ending in a plain action/draft node.",
      "(c) At least ONE verification node must form a critic-revision LOOP: the Check node has a \"fail\"/\"no\" edge back to a revision node, and the revision node routes back into the same Check node. Only the \"pass\"/\"yes\" edge exits the loop to the next step (or to another verification terminal).",
      "(d) Put verification checks on the things that are easy to get wrong for this specific task: tone, length, constraint satisfaction, format compliance, factual consistency with extracted facts, rubric items. Generic \"Check: looks good\" is rejected - each verification node must name WHAT it verifies.",
      "(e) If the task has N distinct constraints, prefer N separate Check nodes over one mega-check.",
      "",
      "Minimal valid shape (you MUST reproduce this loop structure):",
      "  ...",
      "  F[Draft response: empathetic tone, under 250 words]",
      "  F --> G{Check: tone empathetic AND under 250 words?}",
      "  G -- \"no\" --> H[Revise: fix failing constraint]",
      "  H --> G",
      "  G -- \"yes\" --> I[Verify: all extracted facts referenced]",
      "  I -- \"no\" --> H",
      "  I -- \"yes\" --> J[Assert: no disallowed topics]",
      "  J -- \"no\" --> H",
      "  J -- \"yes\" --> K[Critic: final self-review against rubric]",
      "",
      "Before responding, self-check that every Check node has both pass and fail edges and no verification label is vague (\"Check: output\", \"Verify: done\").",
    ].join("\n   "),
  },
  {
    id: "dag-structure",
    title: "DAG STRUCTURE",
    compact:
      "The graph is a DAG except for the critic-revision loops required by terminal verification.",
    detail:
      "The graph must be a Directed Acyclic Graph EXCEPT for the critic-revision loops required in rule 5. No other cycles are allowed. The critic-revision loop is not optional - it is part of rule 5.",
  },
  {
    id: "reachability",
    title: "REACHABILITY",
    compact: "Every node must be reachable from the root. No orphan nodes.",
    detail:
      "Every node must be reachable from the root node (typically A). No orphan nodes, no disconnected sub-flows.",
  },
];

export const buildDetailedBraidRulesPrompt = (): string =>
  [
    "Graph principles (MANDATORY):",
    "",
    ...BRAID_RULES.map((rule, index) => `${index + 1}. ${rule.title} - ${rule.detail}`),
  ].join("\n\n");

export const buildCompactBraidRulesPrompt = (): string =>
  [
    "BRAID graph rules (MANDATORY - the linter will check all of these):",
    ...BRAID_RULES.map((rule, index) => `${index + 1}. ${rule.title}: ${rule.compact}`),
    "",
    'Mermaid syntax: start with "flowchart TD;" - use A[label] for actions, A{label?} for decisions, end each line with semicolon.',
  ].join("\n");
