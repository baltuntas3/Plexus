import { useEffect, useRef, useState } from "react";
import { Alert, Box, Paper } from "@mantine/core";
import mermaid from "mermaid";

interface BraidViewProps {
  mermaidCode: string;
}

let initialized = false;

const initMermaid = (): void => {
  if (initialized) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: "dark",
    securityLevel: "loose",
    flowchart: { htmlLabels: true, curve: "basis" },
  });
  initialized = true;
};

export const BraidView = ({ mermaidCode }: BraidViewProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    initMermaid();
    if (!containerRef.current) return;
    const container = containerRef.current;
    const id = `braid-${Math.random().toString(36).slice(2)}`;
    container.innerHTML = "";
    setError(null);

    mermaid
      .render(id, mermaidCode)
      .then(({ svg }) => {
        container.innerHTML = svg;
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "Failed to render diagram";
        setError(message);
      });
  }, [mermaidCode]);

  if (error) {
    return (
      <Alert color="red" title="Mermaid render error">
        {error}
      </Alert>
    );
  }

  return (
    <Paper withBorder p="md">
      <Box ref={containerRef} style={{ overflow: "auto" }} />
    </Paper>
  );
};
