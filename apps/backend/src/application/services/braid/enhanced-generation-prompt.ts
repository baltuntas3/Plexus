// Rule-augmented BRAID generation prompt.
//
// Extends paper Appendix A.1 with the seven quality principles used by the
// Plexus graph linter (NodeAtomicity, AnswerLeakage, DeterministicBranching,
// TerminalVerification, DAGStructure, Reachability, MutualExclusivity).
// The paper's A.1 prompt is intentionally minimal for research parity; this
// enhanced version is the production default — we tell the generator the
// same rules our linter would flag, so issues are avoided upfront rather
// than caught after the fact.
//
// When this template is updated, bump PROMPT_TEMPLATE_VERSION in the generator
// so cached graphs produced by older versions are not reused.

import { buildDetailedBraidRulesPrompt } from "./braid-rules-prompt.js";

// Single source of truth for the Mermaid output contract. Used by the
// initial generation prompt and the repair prompt so a relaxed format on
// one side cannot create asymmetries — both turns must produce text the
// parser/validator accepts under the same rules.
export const MERMAID_OUTPUT_CONTRACT = [
  "Shape vocabulary:",
  "- A[Label]   — step (action, observation, draft, check)",
  "- A{Label?}  — decision point (used with labeled branches)",
  "",
  "Output Requirements (STRICT):",
  "1. Output ONLY Mermaid code. No markdown fences, no prose, no explanation.",
  "2. Start exactly with \"flowchart TD;\" on the first line.",
  "3. End each statement with a semicolon.",
  "4. Node IDs are letters or short alphanumerics (A, B, C1, G2). Never quote IDs.",
].join("\n");

export const ENHANCED_SYSTEM_PROMPT = `You are an expert at designing BRAID (Bounded Reasoning for Autonomous Inference and Decisions) graphs. Your job is to convert a task description into a Mermaid flowchart that a smaller solver model will traverse step-by-step to produce the final response.

Task:
- Read the task description in the next user message.
- Extract constraints, user-provided facts, references, and goals.
- Produce a flowchart plan that guides the solver to the best final reply.
- Do NOT write the response itself — only the plan the solver will follow.

${buildDetailedBraidRulesPrompt()}

${MERMAID_OUTPUT_CONTRACT}`;
