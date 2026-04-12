import { ENHANCED_SYSTEM_PROMPT } from "../enhanced-generation-prompt.js";
import {
  a1Builder,
  enhancedBuilder,
  getGenerationPromptBuilder,
} from "../prompt-builder.js";

describe("enhanced generation prompt", () => {
  it("includes all seven BRAID quality principles", () => {
    const expectedPrinciples = [
      "NODE ATOMICITY",
      "ANSWER LEAKAGE",
      "DETERMINISTIC BRANCHING",
      "MUTUAL EXCLUSIVITY",
      "TERMINAL VERIFICATION",
      "DAG STRUCTURE",
      "REACHABILITY",
    ];
    for (const principle of expectedPrinciples) {
      expect(ENHANCED_SYSTEM_PROMPT).toContain(principle);
    }
  });

  it("mentions good and bad node examples", () => {
    expect(ENHANCED_SYSTEM_PROMPT).toContain("Extract user intent");
    expect(ENHANCED_SYSTEM_PROMPT).toContain("Draft response");
    expect(ENHANCED_SYSTEM_PROMPT).toContain("Dear Team");
  });

  it("describes diamond decision nodes with branch format", () => {
    expect(ENHANCED_SYSTEM_PROMPT).toContain("{Billing or Technical?}");
    expect(ENHANCED_SYSTEM_PROMPT).toContain('-- "Billing" -->');
  });

  it("describes the allowed critic-revision loop pattern", () => {
    expect(ENHANCED_SYSTEM_PROMPT).toContain("Check: tone");
    expect(ENHANCED_SYSTEM_PROMPT).toContain("Revise tone");
  });

  it("enforces strict output format (flowchart TD, no fences)", () => {
    expect(ENHANCED_SYSTEM_PROMPT).toContain("flowchart TD;");
    expect(ENHANCED_SYSTEM_PROMPT).toContain("ONLY Mermaid code");
  });
});

describe("prompt-builder defaults", () => {
  it("returns the enhanced builder for any task type by default", () => {
    const builder = getGenerationPromptBuilder("general");
    expect(builder).toBe(enhancedBuilder);
  });

  it("enhanced builder produces a two-message chat with system + user", () => {
    const messages = enhancedBuilder({
      classicalPrompt: "Summarize the article",
      conversationText: "Summarize the article",
    });
    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe("system");
    expect(messages[1]?.role).toBe("user");
    expect(messages[1]?.content).toContain("Summarize the article");
  });

  it("a1 builder is still reachable as a baseline (paper-pure)", () => {
    const messages = a1Builder({
      classicalPrompt: "Summarize",
      conversationText: "Summarize",
    });
    expect(messages).toHaveLength(2);
    // A.1 does NOT include the verbose principles section
    expect(messages[0]?.content).not.toContain("NODE ATOMICITY");
  });
});
