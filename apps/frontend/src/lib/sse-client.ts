// Minimal SSE consumer over `fetch`. Uses streaming so we can pass an
// Authorization header (the native EventSource API can't). Returns an
// AbortController so the caller can cancel.

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:4000";

export interface SSEMessage {
  event: string;
  data: string;
}

export interface OpenStreamOptions {
  token: string;
  onMessage: (message: SSEMessage) => void;
  onError?: (err: unknown) => void;
}

export const openSSE = (path: string, options: OpenStreamOptions): AbortController => {
  const controller = new AbortController();

  void (async () => {
    try {
      const response = await fetch(`${API_URL}${path}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${options.token}`,
          Accept: "text/event-stream",
        },
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        throw new Error(`SSE request failed: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE messages are separated by a blank line.
        let blankLine = buffer.indexOf("\n\n");
        while (blankLine !== -1) {
          const raw = buffer.slice(0, blankLine);
          buffer = buffer.slice(blankLine + 2);
          const message = parseEventBlock(raw);
          if (message) options.onMessage(message);
          blankLine = buffer.indexOf("\n\n");
        }
      }
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") return;
      options.onError?.(err);
    }
  })();

  return controller;
};

const parseEventBlock = (raw: string): SSEMessage | null => {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join("\n") };
};
