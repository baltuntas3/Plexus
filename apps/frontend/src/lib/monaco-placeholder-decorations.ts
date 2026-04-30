import type { Monaco, OnMount } from "@monaco-editor/react";
import { VARIABLE_PLACEHOLDER_PATTERN } from "@plexus/shared-types";

// Editor instance & decoration types are not exported by `@monaco-editor/react`,
// so we derive them from the `OnMount` callback signature instead of pulling
// in `monaco-editor` directly (which is a peer dep we don't bundle).
export type EditorInstance = Parameters<OnMount>[0];
type DeltaDecoration = Parameters<EditorInstance["deltaDecorations"]>[1][number];

// Monaco decoration class names. Defined globally and applied as a CSS rule
// via `ensurePlaceholderStyles` below so the inline `{{var}}` highlight
// survives editor remounts. Colours picked to read on the vs-dark theme.
const PLACEHOLDER_STYLE_ID = "plexus-placeholder-style";
const KNOWN_CLASS = "plexus-placeholder-known";
const UNKNOWN_CLASS = "plexus-placeholder-unknown";

export const ensurePlaceholderStyles = (): void => {
  if (typeof document === "undefined") return;
  if (document.getElementById(PLACEHOLDER_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = PLACEHOLDER_STYLE_ID;
  style.textContent = `
    .${KNOWN_CLASS} {
      background-color: rgba(64, 192, 87, 0.2);
      border-radius: 2px;
      font-weight: 600;
    }
    .${UNKNOWN_CLASS} {
      background-color: rgba(250, 82, 82, 0.25);
      border-radius: 2px;
      font-weight: 600;
      text-decoration: underline wavy rgba(250, 82, 82, 0.7);
    }
  `;
  document.head.appendChild(style);
};

// Repaints `{{var}}` decorations on `editor` based on `declaredNames`. Known
// references render in green, unknown ones in red with a tooltip telling
// the user to declare the variable. Returns the new decoration ids so the
// caller can pass them in on the next call (Monaco diff API).
export const paintPlaceholderDecorations = (
  monaco: Monaco,
  editor: EditorInstance,
  declaredNames: ReadonlySet<string>,
  previousIds: readonly string[],
): string[] => {
  const model = editor.getModel();
  if (!model) return [];
  const text = model.getValue();
  const decorations: DeltaDecoration[] = [];
  for (const match of text.matchAll(VARIABLE_PLACEHOLDER_PATTERN)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const startPos = model.getPositionAt(start);
    const endPos = model.getPositionAt(end);
    const inner = match[0].slice(2, -2).trim();
    const isKnown = declaredNames.has(inner);
    decorations.push({
      range: new monaco.Range(
        startPos.lineNumber,
        startPos.column,
        endPos.lineNumber,
        endPos.column,
      ),
      options: {
        inlineClassName: isKnown ? KNOWN_CLASS : UNKNOWN_CLASS,
        hoverMessage: {
          value: isKnown
            ? `Declared variable: \`${inner}\``
            : `Undeclared placeholder \`${inner}\` — add it to Variables before saving.`,
        },
      },
    });
  }
  return editor.deltaDecorations([...previousIds], decorations);
};
