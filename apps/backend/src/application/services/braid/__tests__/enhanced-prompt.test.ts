import { ENHANCED_SYSTEM_PROMPT } from "../enhanced-generation-prompt.js";

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

  it("describes the required critic-revision loop pattern", () => {
    expect(ENHANCED_SYSTEM_PROMPT).toContain("Check:");
    expect(ENHANCED_SYSTEM_PROMPT).toContain("Revise:");
    expect(ENHANCED_SYSTEM_PROMPT).toContain("critic-revision");
  });

  it("forbids plain end/output nodes as terminals", () => {
    expect(ENHANCED_SYSTEM_PROMPT).toContain("FORBIDDEN as a terminal");
    expect(ENHANCED_SYSTEM_PROMPT).toContain("zero outgoing edges");
  });

  it("enforces strict output format (flowchart TD, no fences)", () => {
    expect(ENHANCED_SYSTEM_PROMPT).toContain("flowchart TD;");
    expect(ENHANCED_SYSTEM_PROMPT).toContain("ONLY Mermaid code");
  });
});
