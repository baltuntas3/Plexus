import { Suspense, useRef, useState } from "react";
import {
  ActionIcon,
  Button,
  Group,
  Loader,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Text,
  Textarea,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useAtomValue, useSetAtom } from "jotai";
import type { GraphQualityScoreDto } from "@plexus/shared-types";
import {
  braidChatAtom,
  modelsAtom,
  saveBraidFromChatAtom,
} from "../atoms/braid.atoms.js";
import { ApiError } from "../lib/api-client.js";

// Chat history entry. `text` carries either the raw user/agent message
// content or a serialized diagram-suggestion summary; the optional
// `suggestion` field carries the structured payload the agent returned
// (mermaid + quality score) so the UI can render a save button +
// linter inline. Persistence is per-session: the array lives in
// component state, gets wiped on navigation, and is sent back to the
// backend each turn as `BraidChatTurn[]`.
interface ChatMessage {
  role: "user" | "agent";
  text: string;
  suggestion?: {
    mermaidCode: string;
    qualityScore: GraphQualityScoreDto;
    generatorModel: string;
    saved: boolean;
    savedAs?: string;
  };
}

// Model picker — needs Suspense because modelsAtom is async. Local to
// the chat panel since it's the only consumer; the evaluate panel uses
// a different multi-select control.
const ModelSelect = ({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
}) => {
  const models = useAtomValue(modelsAtom);
  return (
    <Select
      placeholder="Select model"
      size="xs"
      value={value}
      onChange={onChange}
      data={models.map((m) => ({
        value: m.id,
        label: `${m.displayName} ($${m.inputPricePerMillion}/$${m.outputPricePerMillion}/1M)`,
      }))}
      searchable
      style={{ minWidth: 220 }}
    />
  );
};

interface BraidChatPanelProps {
  promptId: string;
  version: string;
  currentMermaid: string | null;
  // Called when the agent returns a diagram suggestion. The version
  // detail page mirrors the latest mermaid into its main render
  // without navigating — saving is a separate explicit action and
  // does not trigger this callback.
  onResult: (
    mermaidCode: string,
    qualityScore: GraphQualityScoreDto,
    newVersion: string | null,
  ) => void;
}

export const BraidChatPanel = ({
  promptId,
  version,
  currentMermaid,
  onResult,
}: BraidChatPanelProps) => {
  const chat = useSetAtom(braidChatAtom);
  const saveFromChat = useSetAtom(saveBraidFromChatAtom);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [model, setModel] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingIndex, setSavingIndex] = useState<number | null>(null);
  const viewport = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    viewport.current?.scrollTo({ top: viewport.current.scrollHeight, behavior: "smooth" });
  };

  // Backend takes prior history + new userMessage separately. Each prior
  // entry is rendered to a single string — for diagrams we send the
  // raw mermaid back so the LLM has the same context the user does.
  const buildHistory = (): { role: "user" | "agent"; content: string }[] =>
    messages.map((m) => ({
      role: m.role,
      content: m.suggestion ? m.suggestion.mermaidCode : m.text,
    }));

  const handleSend = async (overrideMessage?: string) => {
    const text = (overrideMessage ?? input).trim();
    if (!text) return;
    if (!model) {
      notifications.show({ color: "yellow", title: "Model required", message: "Pick a generator model" });
      return;
    }

    const history = buildHistory();
    const userMsg: ChatMessage = { role: "user", text };
    setMessages((prev) => [...prev, userMsg]);
    if (overrideMessage === undefined) setInput("");
    setLoading(true);

    try {
      const result = await chat({
        promptId,
        version,
        body: { history, userMessage: text, generatorModel: model },
      });

      if (result.type === "question") {
        setMessages((prev) => [...prev, { role: "agent", text: result.question }]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            role: "agent",
            text: `Suggested graph — ${result.qualityScore.overall.toFixed(0)}/100 quality · $${result.usage.totalUsd.toFixed(4)}`,
            suggestion: {
              mermaidCode: result.mermaidCode,
              qualityScore: result.qualityScore,
              generatorModel: model,
              saved: false,
            },
          },
        ]);
        // Live-render the latest diagram in the main panel without
        // navigating away — saving is a separate explicit action.
        onResult(result.mermaidCode, result.qualityScore, null);
      }
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Agent failed";
      setMessages((prev) => [...prev, { role: "agent", text: `Error: ${message}` }]);
    } finally {
      setLoading(false);
      setTimeout(scrollToBottom, 50);
    }
  };

  const handleSave = async (index: number) => {
    const msg = messages[index];
    if (!msg?.suggestion || msg.suggestion.saved) return;
    setSavingIndex(index);
    try {
      const res = await saveFromChat({
        promptId,
        version,
        body: {
          mermaidCode: msg.suggestion.mermaidCode,
          generatorModel: msg.suggestion.generatorModel,
        },
      });
      setMessages((prev) =>
        prev.map((m, i) =>
          i === index && m.suggestion
            ? {
                ...m,
                suggestion: { ...m.suggestion, saved: true, savedAs: res.newVersion },
              }
            : m,
        ),
      );
      notifications.show({
        color: "green",
        title: "Version saved",
        message: `Created ${res.newVersion}`,
      });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Failed to save";
      notifications.show({ color: "red", title: "Error", message });
    } finally {
      setSavingIndex(null);
    }
  };

  const handleFix = (qualityScore: GraphQualityScoreDto) => {
    // Linter-feedback shortcut. Serializes warnings/errors into a
    // structured user message and sends it back in the same
    // conversation. The user sees the message inline (transparency)
    // and can edit it before sending if they want, but the default
    // path is one-click.
    const findings: string[] = [];
    for (const rule of qualityScore.results) {
      for (const issue of rule.issues) {
        const ref = issue.nodeId
          ? `node=${issue.nodeId}`
          : issue.edgeKey
          ? `edge=${issue.edgeKey}`
          : "graph";
        findings.push(`[rule=${rule.ruleId}, ${ref}, severity=${issue.severity}] ${issue.message}`);
      }
    }
    if (findings.length === 0) return;
    const message = [
      "The linter flagged the following issues — please fix them while preserving the existing graph structure where possible:",
      ...findings.map((f) => `- ${f}`),
    ].join("\n");
    void handleSend(message);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  return (
    <Stack gap="xs" h="100%" style={{ display: "flex", flexDirection: "column" }}>
      <Group justify="space-between" wrap="nowrap">
        <Text size="sm" fw={600}>
          BRAID Agent
        </Text>
        <Suspense fallback={<Loader size="xs" />}>
          <ModelSelect value={model} onChange={setModel} />
        </Suspense>
      </Group>

      <ScrollArea
        viewportRef={viewport}
        style={{ flex: 1, minHeight: 180 }}
        type="auto"
      >
        {messages.length === 0 ? (
          <Text size="xs" c="dimmed" ta="center" py="lg">
            {currentMermaid
              ? "Describe how to refine the graph, or ask the agent to make changes."
              : "Describe the task and the agent will generate a BRAID graph."}
          </Text>
        ) : (
          <Stack gap={6} px={4}>
            {messages.map((msg, i) => {
              const showFix =
                msg.suggestion !== undefined
                && (msg.suggestion.qualityScore.overall < 80
                  || msg.suggestion.qualityScore.results.some((r) =>
                    r.issues.some((iss) => iss.severity === "warning" || iss.severity === "error"),
                  ));
              return (
                <Paper
                  key={i}
                  px="sm"
                  py={6}
                  radius="sm"
                  style={{
                    background: msg.role === "user" ? "#1e3a5f" : "#1a2a1a",
                    alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
                    maxWidth: "90%",
                  }}
                >
                  <Text size="xs" c={msg.role === "user" ? "#93c5fd" : "#86efac"}>
                    {msg.role === "user" ? "You" : "Agent"}
                  </Text>
                  <Text size="xs" style={{ whiteSpace: "pre-wrap" }}>
                    {msg.text}
                  </Text>
                  {msg.suggestion && (
                    <Group gap="xs" mt={6}>
                      <Button
                        size="compact-xs"
                        variant={msg.suggestion.saved ? "light" : "filled"}
                        color={msg.suggestion.saved ? "gray" : "blue"}
                        loading={savingIndex === i}
                        disabled={msg.suggestion.saved}
                        onClick={() => void handleSave(i)}
                      >
                        {msg.suggestion.saved
                          ? `Saved as ${msg.suggestion.savedAs}`
                          : "Save this version"}
                      </Button>
                      {showFix && !msg.suggestion.saved && (
                        <Button
                          size="compact-xs"
                          variant="subtle"
                          color="orange"
                          onClick={() => msg.suggestion && handleFix(msg.suggestion.qualityScore)}
                        >
                          Fix linter issues
                        </Button>
                      )}
                    </Group>
                  )}
                </Paper>
              );
            })}
            {loading && (
              <Group gap="xs" px={4}>
                <Loader size="xs" />
                <Text size="xs" c="dimmed">Agent is thinking…</Text>
              </Group>
            )}
          </Stack>
        )}
      </ScrollArea>

      <Group gap="xs" wrap="nowrap" align="flex-end">
        <Textarea
          style={{ flex: 1 }}
          size="xs"
          placeholder={currentMermaid ? "Refine the graph…" : "Describe the BRAID you want…"}
          value={input}
          onChange={(e) => setInput(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          autosize
          minRows={1}
          maxRows={4}
          disabled={loading}
        />
        <ActionIcon
          variant="filled"
          size="lg"
          onClick={() => void handleSend()}
          loading={loading}
          disabled={!input.trim() || !model}
        >
          ↑
        </ActionIcon>
      </Group>
    </Stack>
  );
};
