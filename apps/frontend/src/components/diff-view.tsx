import { useMemo } from "react";
import { Box, Text } from "@mantine/core";
import { diffLines } from "diff";

interface DiffViewProps {
  oldText: string;
  newText: string;
  emptyLabel?: string;
}

interface RenderedLine {
  key: string;
  type: "added" | "removed" | "context";
  text: string;
}

const buildLines = (oldText: string, newText: string): RenderedLine[] => {
  const changes = diffLines(oldText, newText);
  const lines: RenderedLine[] = [];
  let counter = 0;
  for (const change of changes) {
    const type: RenderedLine["type"] = change.added
      ? "added"
      : change.removed
        ? "removed"
        : "context";
    const split = change.value.replace(/\n$/, "").split("\n");
    for (const text of split) {
      lines.push({ key: `${counter++}`, type, text });
    }
  }
  return lines;
};

const colorMap: Record<RenderedLine["type"], { bg: string; symbol: string; color: string }> = {
  added: { bg: "rgba(46, 160, 67, 0.2)", symbol: "+", color: "#3fb950" },
  removed: { bg: "rgba(248, 81, 73, 0.2)", symbol: "-", color: "#f85149" },
  context: { bg: "transparent", symbol: " ", color: "#9ca3af" },
};

export const DiffView = ({ oldText, newText, emptyLabel = "No changes" }: DiffViewProps) => {
  const lines = useMemo(() => buildLines(oldText, newText), [oldText, newText]);

  const hasChanges = lines.some((l) => l.type !== "context");
  if (!hasChanges) {
    return (
      <Text c="dimmed" size="sm" p="md">
        {emptyLabel}
      </Text>
    );
  }

  return (
    <Box
      style={{
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 12,
        lineHeight: 1.5,
        maxHeight: 320,
        overflow: "auto",
      }}
    >
      {lines.map((line) => {
        const style = colorMap[line.type];
        return (
          <Box
            key={line.key}
            style={{
              backgroundColor: style.bg,
              color: style.color,
              paddingLeft: 8,
              paddingRight: 8,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            <span style={{ display: "inline-block", width: 16, opacity: 0.7 }}>{style.symbol}</span>
            {line.text || " "}
          </Box>
        );
      })}
    </Box>
  );
};
