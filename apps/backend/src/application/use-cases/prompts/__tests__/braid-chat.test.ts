import type { BraidChatTurn } from "@plexus/shared-types";
import { BraidChatUseCase } from "../braid-chat.js";
import { CreatePromptUseCase } from "../create-prompt.js";
import { BraidChatAgentFactory } from "../../../services/braid/braid-chat-agent-factory.js";
import { createDefaultGraphLinter } from "../../../services/braid/lint/default-graph-linter.js";
import {
  FakeAIProvider,
  FakeAIProviderFactory,
} from "../../../../__tests__/fakes/fake-ai-provider.js";
import { InMemoryIdGenerator } from "../../../../__tests__/fakes/in-memory-id-generator.js";
import { InMemoryPromptAggregateRepository } from "../../../../__tests__/fakes/in-memory-prompt-aggregate-repository.js";
import { InMemoryPromptVersionRepository } from "../../../../__tests__/fakes/in-memory-prompt-version-repository.js";
import { NoOpUnitOfWork } from "../../../../__tests__/fakes/no-op-unit-of-work.js";

const organizationId = "org-1";
const userId = "u-1";
const generatorModel = "llama-3.3-70b-versatile";

const validMermaid = [
  "flowchart TD;",
  "  Start[Read input];",
  "  Plan[Plan steps];",
  "  Check[Verify result];",
  "  Fix[Revise on fail];",
  "  Start --> Plan;",
  "  Plan --> Check;",
  "  Check -- fail --> Fix;",
  "  Fix --> Check;",
].join("\n");

const setup = async (
  responder: (input: { messages: Array<{ role: string; content: string }> }) => {
    text: string;
    inputTokens?: number;
    outputTokens?: number;
  },
) => {
  const prompts = new InMemoryPromptAggregateRepository();
  const versions = new InMemoryPromptVersionRepository();
  const ids = new InMemoryIdGenerator();
  const uow = new NoOpUnitOfWork();
  const provider = new FakeAIProvider((req) => {
    const r = responder(req);
    return {
      text: r.text,
      model: req.model,
      usage: {
        inputTokens: r.inputTokens ?? 100,
        outputTokens: r.outputTokens ?? 50,
      },
    };
  });
  const agents = new BraidChatAgentFactory(new FakeAIProviderFactory(provider));
  const linter = createDefaultGraphLinter();

  const createPrompt = new CreatePromptUseCase(prompts, versions, ids, uow);
  const { prompt } = await createPrompt.execute({
    organizationId,
    userId,
    name: "Summarizer",
    description: "",
    taskType: "general",
    initialPrompt: "Summarize the input.",
  });

  return {
    promptId: prompt.id,
    chat: new BraidChatUseCase(prompts, versions, agents, linter),
    provider,
    versions,
  };
};

describe("BraidChatUseCase", () => {
  it("returns a diagram suggestion without persisting a new version", async () => {
    const { chat, promptId, versions } = await setup(() => ({
      text: JSON.stringify({ type: "diagram", mermaid: validMermaid }),
    }));

    const before = await versions.findByPromptAndLabelInOrganization(
      promptId,
      "v1",
      organizationId,
    );

    const result = await chat.execute({
      promptId,
      version: "v1",
      organizationId,
      userMessage: "draft a graph",
      history: [],
      generatorModel,
    });

    expect(result.type).toBe("diagram");
    if (result.type === "diagram") {
      expect(result.mermaidCode).toContain("flowchart TD");
      expect(result.qualityScore.overall).toBeGreaterThan(0);
    }

    // Persistence is the explicit `SaveBraidFromChat` job — chat alone
    // must not fork. The pre/post version listing is identical.
    const after = await versions.findByPromptAndLabelInOrganization(
      promptId,
      "v1",
      organizationId,
    );
    expect(before?.id).toBe(after?.id);
    const v2 = await versions.findByPromptAndLabelInOrganization(
      promptId,
      "v2",
      organizationId,
    );
    expect(v2).toBeNull();
  });

  it("forwards the prior history into the LLM call", async () => {
    const { chat, promptId, provider } = await setup(() => ({
      text: JSON.stringify({ type: "question", text: "what task type?" }),
    }));

    const history: BraidChatTurn[] = [
      { role: "user", content: "let's start" },
      { role: "agent", content: "okay, what's the input shape?" },
    ];
    await chat.execute({
      promptId,
      version: "v1",
      organizationId,
      userMessage: "json",
      history,
      generatorModel,
    });

    // System + 2 prior turns + new user message = 4 messages.
    expect(provider.lastRequest?.messages.length).toBe(4);
    expect(provider.lastRequest?.messages[0]?.role).toBe("system");
    expect(provider.lastRequest?.messages[1]).toEqual({ role: "user", content: "let's start" });
    expect(provider.lastRequest?.messages[2]).toEqual({
      role: "assistant",
      content: "okay, what's the input shape?",
    });
    expect(provider.lastRequest?.messages[3]).toEqual({ role: "user", content: "json" });
  });

  it("returns a question response when the agent asks for clarification", async () => {
    const { chat, promptId } = await setup(() => ({
      text: JSON.stringify({ type: "question", text: "what input format?" }),
    }));
    const result = await chat.execute({
      promptId,
      version: "v1",
      organizationId,
      userMessage: "make it",
      history: [],
      generatorModel,
    });
    expect(result.type).toBe("question");
    if (result.type === "question") {
      expect(result.question).toBe("what input format?");
    }
  });

  it("rejects history that exceeds the message-count hard limit", async () => {
    const { chat, promptId } = await setup(() => ({
      text: JSON.stringify({ type: "diagram", mermaid: validMermaid }),
    }));
    const history: BraidChatTurn[] = Array.from({ length: 51 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "agent",
      content: `turn ${i}`,
    }));
    await expect(
      chat.execute({
        promptId,
        version: "v1",
        organizationId,
        userMessage: "more",
        history,
        generatorModel,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects history that exceeds the total-character hard limit", async () => {
    const { chat, promptId } = await setup(() => ({
      text: JSON.stringify({ type: "diagram", mermaid: validMermaid }),
    }));
    // ~120k characters splits into 12 × 10k turns to stay under the
    // message-count limit while crossing the character ceiling.
    const big = "x".repeat(10_000);
    const history: BraidChatTurn[] = Array.from({ length: 13 }, () => ({
      role: "user",
      content: big,
    }));
    await expect(
      chat.execute({
        promptId,
        version: "v1",
        organizationId,
        userMessage: "more",
        history,
        generatorModel,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
