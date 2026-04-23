import { DomainError } from "../../errors/domain-error.js";
import { PromptContent } from "../prompt-content.js";

describe("PromptContent", () => {
  it("trims surrounding whitespace", () => {
    expect(PromptContent.create("  summarize this  ").toString()).toBe("summarize this");
  });

  it("rejects blank content", () => {
    expect(() => PromptContent.create("   ")).toThrow(DomainError);
  });
});
