import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Group, Popover, Stack, Text, TextInput } from "@mantine/core";
import {
  VARIABLE_NAME_PATTERN,
  type PromptVariableDto,
} from "@plexus/shared-types";

interface VariableAwareInputProps {
  label?: string;
  placeholder?: string;
  value: string;
  onChange: (next: string) => void;
  variables: ReadonlyArray<PromptVariableDto>;
  // Forwarded to the inner TextInput for parity with form integrations
  // (autoFocus, data-autofocus, maxLength, etc.). Whitelisted to avoid
  // accidentally overriding the controlled props.
  autoFocus?: boolean;
  maxLength?: number;
  disabled?: boolean;
  // Hook for the inline "create new variable" flow. When provided and
  // the user types a query that matches no declared variable but is a
  // valid name, an extra popup option lets them declare it on the
  // spot. The parent (modal) tracks the new name so it can be
  // bundled into the structural-edit payload at save time. Without
  // this prop the inline-create option is hidden — caller opts in.
  onCreateVariable?: (name: string) => void;
}

interface ActiveQuery {
  // Index of the `{{` pair in the input value. The query is the
  // characters between `{{` and the caret; replacement targets the
  // half-open range [start, caret).
  start: number;
  query: string;
}

// Backward-scan for the most recent `{{` from the caret that has no
// closing `}}` between it and the caret. Returns null when the user
// is not inside an autocomplete window. Variable names can't contain
// whitespace, so any whitespace in the query closes the window — keeps
// the popup from sticking after the user moves on to free-form text.
const findActiveQuery = (text: string, caret: number): ActiveQuery | null => {
  const lastOpen = text.lastIndexOf("{{", caret - 1);
  if (lastOpen === -1) return null;
  const between = text.slice(lastOpen + 2, caret);
  if (between.includes("}}")) return null;
  if (/\s/.test(between)) return null;
  return { start: lastOpen, query: between };
};

export const VariableAwareInput = ({
  label,
  placeholder,
  value,
  onChange,
  variables,
  autoFocus,
  maxLength,
  disabled,
  onCreateVariable,
}: VariableAwareInputProps) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [activeQuery, setActiveQuery] = useState<ActiveQuery | null>(null);
  const [highlightIndex, setHighlightIndex] = useState(0);

  // Filter declared variables by the active query prefix. Empty query
  // shows everything (the moment the user types `{{`).
  const matches = useMemo(() => {
    if (!activeQuery) return [];
    const q = activeQuery.query.toLowerCase();
    return variables.filter((v) => v.name.toLowerCase().startsWith(q));
  }, [activeQuery, variables]);

  // Inline-create option appears when the user typed a syntactically
  // valid name that isn't already declared, and the parent opted in
  // via `onCreateVariable`. Without it, typing `{{newVar}}` just
  // inserts a literal that the backend's variable-integrity check
  // would reject at save time — surfacing the create option lets the
  // user declare it in the same flow.
  const canCreate = useMemo(() => {
    if (!activeQuery || !onCreateVariable) return false;
    const q = activeQuery.query;
    if (q.length === 0) return false;
    if (!VARIABLE_NAME_PATTERN.test(q)) return false;
    if (variables.some((v) => v.name === q)) return false;
    return true;
  }, [activeQuery, variables, onCreateVariable]);

  // Total navigable items = existing matches + (canCreate ? 1 : 0).
  // The create entry sits at index `matches.length`.
  const itemCount = matches.length + (canCreate ? 1 : 0);
  const createIndex = matches.length;

  // Reset highlight to the first item every time the candidate set
  // changes; out-of-range otherwise after typing.
  useEffect(() => {
    setHighlightIndex(0);
  }, [matches, canCreate]);

  const recomputeQuery = (text: string, caret: number) => {
    setActiveQuery(findActiveQuery(text, caret));
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.currentTarget.value);
    recomputeQuery(e.currentTarget.value, e.currentTarget.selectionStart ?? 0);
  };

  // Caret can move via clicks/arrows without a value change; re-derive
  // the active query so the popup follows the caret.
  const handleSelectChange = (e: React.SyntheticEvent<HTMLInputElement>) => {
    const el = e.currentTarget;
    recomputeQuery(el.value, el.selectionStart ?? 0);
  };

  const insert = (variableName: string) => {
    if (!activeQuery) return;
    const before = value.slice(0, activeQuery.start);
    // Caret position from the input — fall back to length if the ref
    // isn't ready yet.
    const caret = inputRef.current?.selectionStart ?? value.length;
    const after = value.slice(caret);
    const inserted = `{{${variableName}}}`;
    const next = `${before}${inserted}${after}`;
    onChange(next);
    setActiveQuery(null);
    // Restore caret after the inserted token so the user can keep
    // typing where they left off.
    requestAnimationFrame(() => {
      const pos = before.length + inserted.length;
      inputRef.current?.setSelectionRange(pos, pos);
      inputRef.current?.focus();
    });
  };

  // Selecting the inline-create entry both notifies the parent (so
  // it can stage the new variable for the next save) and inserts the
  // `{{name}}` token into the input — same UX as picking an existing
  // match but with the side effect of registering the new declaration.
  const handleCreate = (name: string) => {
    onCreateVariable?.(name);
    insert(name);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!activeQuery || itemCount === 0) {
      // Esc still closes the popup if it's open with no items.
      if (e.key === "Escape" && activeQuery) {
        setActiveQuery(null);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIndex((i) => Math.min(i + 1, itemCount - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlightIndex < matches.length) {
        const pick = matches[highlightIndex];
        if (pick) insert(pick.name);
      } else if (canCreate && activeQuery) {
        handleCreate(activeQuery.query);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setActiveQuery(null);
    }
  };

  const popoverOpened = activeQuery !== null && itemCount > 0;

  return (
    <Popover
      opened={popoverOpened}
      position="bottom-start"
      withinPortal
      shadow="md"
      transitionProps={{ duration: 0 }}
    >
      <Popover.Target>
        <TextInput
          ref={inputRef}
          label={label}
          placeholder={placeholder}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onClick={handleSelectChange}
          onKeyUp={handleSelectChange}
          autoFocus={autoFocus}
          maxLength={maxLength}
          disabled={disabled}
        />
      </Popover.Target>
      <Popover.Dropdown
        // Stop the dropdown from stealing focus from the input — the
        // user is typing, the popup is just listening.
        onMouseDown={(e) => e.preventDefault()}
        p={4}
      >
        <Stack gap={2} maw={320}>
          {matches.map((v, i) => (
            <Group
              key={v.name}
              gap="xs"
              wrap="nowrap"
              onClick={() => insert(v.name)}
              onMouseEnter={() => setHighlightIndex(i)}
              style={{
                cursor: "pointer",
                background: i === highlightIndex ? "#1e3a5f" : undefined,
                padding: "4px 8px",
                borderRadius: 4,
              }}
            >
              <Badge color="violet" variant={v.required ? "filled" : "light"}>
                {`{{${v.name}}}`}
              </Badge>
              {v.description && (
                <Text size="xs" c="dimmed" lineClamp={1}>
                  {v.description}
                </Text>
              )}
            </Group>
          ))}
          {canCreate && activeQuery && (
            <Group
              gap="xs"
              wrap="nowrap"
              onClick={() => handleCreate(activeQuery.query)}
              onMouseEnter={() => setHighlightIndex(createIndex)}
              style={{
                cursor: "pointer",
                background:
                  highlightIndex === createIndex ? "#1e3a5f" : undefined,
                padding: "4px 8px",
                borderRadius: 4,
                borderTop:
                  matches.length > 0 ? "1px solid #2a3441" : undefined,
              }}
            >
              <Badge color="green" variant="light">
                + new
              </Badge>
              <Text size="xs">
                Create variable {`{{${activeQuery.query}}}`}
              </Text>
            </Group>
          )}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
};
