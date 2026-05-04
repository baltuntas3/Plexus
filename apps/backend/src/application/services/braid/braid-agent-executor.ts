// BraidAgentExecutor traverses the meta-BRAID (BRAID_AGENT_MERMAID) node by node,
// calling the LLM at each step to build up the output BRAID from a classical prompt.
//
// Traversal rules:
//   - Square action nodes  → call LLM, accumulate state, follow single outgoing edge
//   - Diamond decision     → call LLM for yes/no, follow matching edge
//   - Diamond verification → call LLM to check current draft; on "no" loop back
//                            (max MAX_LOOP_ITERATIONS attempts, then force-pass)
//   - Terminal node        → stop; state.currentDraft is the final Mermaid code

import { BraidGraph } from "../../../domain/value-objects/braid-graph.js";
import { ValidationError } from "../../../domain/errors/domain-error.js";
import type { IAIProvider } from "../ai-provider.js";
import type { TaskType } from "@plexus/shared-types";
import { BRAID_AGENT_MERMAID } from "./braid-agent-graph.js";
import { ENHANCED_SYSTEM_PROMPT } from "./enhanced-generation-prompt.js";

interface AgentExecutionResult {
  mermaidCode: string;
  totalInputTokens: number;
  totalOutputTokens: number;
}

interface AgentState {
  sourcePrompt: string;
  taskType: TaskType;
  analysisContext: string;
  structurePlan: string;
  currentDraft: string;
}

interface EdgeRef {
  to: string;
  label: string | null;
}

const MAX_LOOP_ITERATIONS = 3;

const VERIFICATION_PREFIXES = ["check:", "verify:", "validate:", "assert:", "critic:"];
const startsWithVerification = (label: string): boolean =>
  VERIFICATION_PREFIXES.some((p) => label.toLowerCase().startsWith(p));

const isDiamondNode = (nodeId: string, mermaidCode: string): boolean =>
  new RegExp(`\\b${nodeId}\\s*\\{`).test(mermaidCode);

const buildAdjacency = (graph: BraidGraph): Map<string, EdgeRef[]> => {
  const adj = new Map<string, EdgeRef[]>();
  for (const node of graph.nodes) adj.set(node.id, []);
  for (const edge of graph.edges) {
    adj.get(edge.from)?.push({ to: edge.to, label: edge.label });
  }
  return adj;
};

const findRoot = (graph: BraidGraph): string => {
  const targets = new Set(graph.edges.map((e) => e.to));
  const root = graph.nodes.find((n) => !targets.has(n.id));
  if (!root) throw ValidationError("Meta-BRAID has no root node");
  return root.id;
};

const matchesYes = (label: string | null): boolean =>
  !!(label && /^(yes|pass|true)$/i.test(label.trim()));

const matchesNo = (label: string | null): boolean =>
  !!(label && /^(no|fail|false)$/i.test(label.trim()));

const cleanMermaidCode = (text: string): string => {
  const fenced = /```(?:mermaid)?\s*([\s\S]*?)```/.exec(text.trim());
  return (fenced?.[1]?.trim() ?? text.trim()).replace(/^```.*$/gm, "").trim();
};

export class BraidAgentExecutor {
  private readonly metaGraph: BraidGraph;

  constructor(
    private readonly provider: IAIProvider,
    private readonly model: string,
  ) {
    this.metaGraph = BraidGraph.parse(BRAID_AGENT_MERMAID);
  }

  async execute(sourcePrompt: string, taskType: TaskType): Promise<AgentExecutionResult> {
    const adj = buildAdjacency(this.metaGraph);
    const nodeMap = new Map(this.metaGraph.nodes.map((n) => [n.id, n.label]));

    const state: AgentState = {
      sourcePrompt,
      taskType,
      analysisContext: "",
      structurePlan: "",
      currentDraft: "",
    };

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    const loopCount = new Map<string, number>();

    let currentNodeId: string | null = findRoot(this.metaGraph);

    while (currentNodeId !== null) {
      // Extract to a const so TypeScript can narrow the type to `string`
      const nodeId: string = currentNodeId;
      const label = nodeMap.get(nodeId);
      if (label === undefined) break;

      const outEdges: EdgeRef[] = adj.get(nodeId) ?? [];
      if (outEdges.length === 0) break; // terminal — currentDraft is ready

      const isDiamond = isDiamondNode(nodeId, this.metaGraph.mermaidCode);

      if (isDiamond && startsWithVerification(label)) {
        const result = await this.runVerification(state, label);
        totalInputTokens += result.inputTokens;
        totalOutputTokens += result.outputTokens;

        if (result.revisedCode) state.currentDraft = result.revisedCode;

        const yesEdge: EdgeRef | undefined = outEdges.find((e) => matchesYes(e.label));
        const noEdge: EdgeRef | undefined = outEdges.find((e) => matchesNo(e.label));

        if (result.pass) {
          currentNodeId = yesEdge?.to ?? null;
        } else {
          const count: number = (loopCount.get(nodeId) ?? 0) + 1;
          loopCount.set(nodeId, count);
          // Force-pass after MAX attempts to avoid infinite loop
          currentNodeId =
            count >= MAX_LOOP_ITERATIONS ? (yesEdge?.to ?? null) : (noEdge?.to ?? null);
        }
      } else if (isDiamond) {
        // Pure decision node
        const result = await this.runDecision(state, label);
        totalInputTokens += result.inputTokens;
        totalOutputTokens += result.outputTokens;

        const yesEdge: EdgeRef | undefined = outEdges.find((e) => matchesYes(e.label));
        const noEdge: EdgeRef | undefined = outEdges.find((e) => matchesNo(e.label));
        const chosenEdge: EdgeRef | undefined =
          result.answer === "yes" ? (yesEdge ?? outEdges[0]) : (noEdge ?? outEdges[0]);
        currentNodeId = chosenEdge?.to ?? null;
      } else {
        // Action node (analysis, design, draft, revise, add)
        const result = await this.runAction(state, label);
        totalInputTokens += result.inputTokens;
        totalOutputTokens += result.outputTokens;
        const firstEdge: EdgeRef | undefined = outEdges[0];
        currentNodeId = firstEdge?.to ?? null;
      }
    }

    if (!state.currentDraft) {
      throw ValidationError("BRAID agent produced no output — no draft was created");
    }

    return { mermaidCode: state.currentDraft, totalInputTokens, totalOutputTokens };
  }

  // ── Action dispatch ─────────────────────────────────────────────────────────

  private async runAction(
    state: AgentState,
    nodeLabel: string,
  ): Promise<{ inputTokens: number; outputTokens: number }> {
    const lower = nodeLabel.toLowerCase();

    if (lower.startsWith("draft:")) {
      return this.runInitialDraft(state);
    }
    if (
      lower.startsWith("revise:") ||
      lower.startsWith("add:") ||
      lower.startsWith("fix:")
    ) {
      return this.runRevision(state, nodeLabel);
    }
    if (lower.startsWith("design:")) {
      return this.runDesign(state, nodeLabel);
    }
    // parse: / extract: / plan: → analysis
    return this.runAnalysis(state, nodeLabel);
  }

  // ── Individual step handlers ─────────────────────────────────────────────────

  private async runAnalysis(
    state: AgentState,
    nodeLabel: string,
  ): Promise<{ inputTokens: number; outputTokens: number }> {
    const response = await this.provider.generate({
      model: this.model,
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "You are a step in a BRAID generation pipeline. Analyze the input and produce a concise structured result for this step (2-5 sentences).",
        },
        {
          role: "user",
          content: [
            `Step: ${nodeLabel}`,
            `\nClassical prompt:\n${state.sourcePrompt}`,
            `\nTask type: ${state.taskType}`,
            `\nPrevious analysis:\n${state.analysisContext || "(none)"}`,
          ].join(""),
        },
      ],
    });
    state.analysisContext += `\n[${nodeLabel}]: ${response.text.trim()}`;
    return response.usage;
  }

  private async runDesign(
    state: AgentState,
    nodeLabel: string,
  ): Promise<{ inputTokens: number; outputTokens: number }> {
    const response = await this.provider.generate({
      model: this.model,
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "You are designing the structure of a BRAID flowchart. Describe the graph structure plan in 3-6 sentences.",
        },
        {
          role: "user",
          content: `Design task: ${nodeLabel}\n\nClassical prompt:\n${state.sourcePrompt}\n\nAnalysis:\n${state.analysisContext}`,
        },
      ],
    });
    state.structurePlan = response.text.trim();
    return response.usage;
  }

  private async runInitialDraft(
    state: AgentState,
  ): Promise<{ inputTokens: number; outputTokens: number }> {
    // Reuse the full enhanced generation prompt for the initial draft.
    // The executor's analysis and structure plan are appended as context.
    const conversationText = [
      state.sourcePrompt,
      state.analysisContext ? `\n\nAnalysis context:\n${state.analysisContext}` : "",
      state.structurePlan ? `\n\nStructure plan:\n${state.structurePlan}` : "",
    ].join("");

    const response = await this.provider.generate({
      model: this.model,
      temperature: 0,
      messages: [
        { role: "system", content: ENHANCED_SYSTEM_PROMPT },
        { role: "user", content: `Conversation:\n${conversationText}` },
      ],
    });
    state.currentDraft = cleanMermaidCode(response.text);
    return response.usage;
  }

  private async runRevision(
    state: AgentState,
    nodeLabel: string,
  ): Promise<{ inputTokens: number; outputTokens: number }> {
    const response = await this.provider.generate({
      model: this.model,
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            'You are revising a BRAID flowchart. Apply the specific fix. Output ONLY the complete corrected Mermaid code starting with "flowchart TD;". No prose, no fences.',
        },
        {
          role: "user",
          content: `Fix task: ${nodeLabel}\n\nCurrent BRAID:\n${state.currentDraft}`,
        },
      ],
    });
    state.currentDraft = cleanMermaidCode(response.text);
    return response.usage;
  }

  private async runDecision(
    state: AgentState,
    nodeLabel: string,
  ): Promise<{ answer: string; inputTokens: number; outputTokens: number }> {
    const response = await this.provider.generate({
      model: this.model,
      temperature: 0,
      messages: [
        { role: "system", content: "Answer with 'yes' or 'no' only." },
        {
          role: "user",
          content: `Question: ${nodeLabel}\n\nClassical prompt:\n${state.sourcePrompt}\n\nAnalysis:\n${state.analysisContext}`,
        },
      ],
    });
    const answer = response.text.trim().toLowerCase().startsWith("yes") ? "yes" : "no";
    return { answer, inputTokens: response.usage.inputTokens, outputTokens: response.usage.outputTokens };
  }

  private async runVerification(
    state: AgentState,
    nodeLabel: string,
  ): Promise<{ pass: boolean; revisedCode?: string; inputTokens: number; outputTokens: number }> {
    const isCritic = nodeLabel.toLowerCase().startsWith("critic:");
    const systemContent = isCritic
      ? [
          "You are a BRAID expert doing a comprehensive review against all 7 quality rules:",
          "node atomicity (<15 tokens), no answer leakage, deterministic branching (labeled edges),",
          "mutual exclusivity, terminal verification loops, DAG structure, reachability.",
          '\nIf ALL rules pass, output exactly: PASS',
          '\nIf any rule fails, output the fully corrected Mermaid code starting with "flowchart TD;". No prose, no fences.',
        ].join(" ")
      : [
          "You are checking a BRAID flowchart against one specific rule.",
          '\nIf the rule passes, output exactly: PASS',
          '\nIf not, output the corrected Mermaid code starting with "flowchart TD;". No prose, no fences.',
        ].join(" ");

    const response = await this.provider.generate({
      model: this.model,
      temperature: 0,
      messages: [
        { role: "system", content: systemContent },
        { role: "user", content: `Rule: ${nodeLabel}\n\nCurrent BRAID:\n${state.currentDraft}` },
      ],
    });

    const text = response.text.trim();
    const pass = /^PASS\b/i.test(text);
    const lower = text.toLowerCase();
    const hasCode =
      !pass && (lower.startsWith("flowchart") || lower.startsWith("graph td"));
    const revisedCode = hasCode ? cleanMermaidCode(text) : undefined;

    return {
      pass,
      revisedCode,
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
    };
  }
}
