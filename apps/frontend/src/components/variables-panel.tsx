import { useMemo } from "react";
import {
  ActionIcon,
  Badge,
  Button,
  Checkbox,
  Group,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { isValidVariableName, type PromptVariableInput } from "@plexus/shared-types";

// Definition-only editor. Runtime values are passed via the SDK
// (`client.prompt(id).run({ vars: {...} })`); this panel never accepts a
// value, only the schema (name / description / default / required).
//
// Validation surfaces inline:
// - invalid name → red border + tooltip
// - duplicate name across rows → red border + "duplicate" badge
// - referenced in body but not declared → "+" suggestion to add the name

interface VariableRowMeta {
  duplicate: boolean;
  invalid: boolean;
  unreferenced: boolean;
}

const computeRowMeta = (
  variables: readonly PromptVariableInput[],
  referenced: ReadonlySet<string>,
): VariableRowMeta[] => {
  const counts = new Map<string, number>();
  for (const v of variables) {
    const name = v.name.trim();
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return variables.map((v) => {
    const name = v.name.trim();
    return {
      duplicate: name.length > 0 && (counts.get(name) ?? 0) > 1,
      invalid: name.length > 0 && !isValidVariableName(name),
      unreferenced: name.length > 0 && !referenced.has(name),
    };
  });
};

export interface VariablesPanelProps {
  value: PromptVariableInput[];
  onChange: (next: PromptVariableInput[]) => void;
  // Names referenced in the body via `{{...}}`. When provided, the panel
  // surfaces undeclared references as quick-add suggestions and flags
  // declared-but-unreferenced variables (warning, not error).
  referenced?: readonly string[];
}

export const VariablesPanel = ({
  value,
  onChange,
  referenced = [],
}: VariablesPanelProps) => {
  const referencedSet = useMemo(() => new Set(referenced), [referenced]);
  const declaredSet = useMemo(
    () => new Set(value.map((v) => v.name.trim()).filter((n) => n.length > 0)),
    [value],
  );
  const undeclared = useMemo(
    () => referenced.filter((name) => !declaredSet.has(name)),
    [referenced, declaredSet],
  );
  const rowMeta = useMemo(
    () => computeRowMeta(value, referencedSet),
    [value, referencedSet],
  );

  const updateRow = (index: number, patch: Partial<PromptVariableInput>) => {
    const next = value.map((v, i) => (i === index ? { ...v, ...patch } : v));
    onChange(next);
  };

  const removeRow = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  const addRow = (initial: Partial<PromptVariableInput> = {}) => {
    onChange([
      ...value,
      {
        name: initial.name ?? "",
        description: null,
        defaultValue: null,
        required: false,
        ...initial,
      },
    ]);
  };

  return (
    <Stack gap="sm">
      <Group justify="space-between" align="center">
        <Text fw={600} size="sm">
          Variables ({value.length})
        </Text>
        <Button size="xs" variant="light" onClick={() => addRow()}>
          Add variable
        </Button>
      </Group>
      <Text c="dimmed" size="xs">
        Define placeholders referenced as <code>{`{{name}}`}</code> in the prompt body. Values are
        passed at runtime via the SDK; this panel only stores the schema.
      </Text>

      {undeclared.length > 0 && (
        <Group gap="xs" wrap="wrap">
          <Text size="xs" c="dimmed">
            Referenced but not declared:
          </Text>
          {undeclared.map((name) => (
            <Tooltip key={name} label="Add to variables list">
              <Badge
                variant="outline"
                color="orange"
                style={{ cursor: "pointer" }}
                onClick={() => addRow({ name })}
              >
                + {name}
              </Badge>
            </Tooltip>
          ))}
        </Group>
      )}

      {value.length === 0 ? (
        <Text c="dimmed" size="sm" fs="italic">
          No variables yet. Click "Add variable" or insert a <code>{`{{name}}`}</code> reference in the body.
        </Text>
      ) : (
        <Stack gap="xs">
          {value.map((variable, index) => {
            const meta = rowMeta[index];
            return (
              <Stack
                key={index}
                gap={4}
                p="xs"
                style={{
                  border: "1px solid var(--mantine-color-default-border)",
                  borderRadius: 6,
                }}
              >
                <Group gap="xs" wrap="nowrap" align="flex-end">
                  <TextInput
                    label="Name"
                    placeholder="e.g., question"
                    size="xs"
                    style={{ flex: 1 }}
                    value={variable.name}
                    error={
                      meta?.invalid
                        ? "Invalid name"
                        : meta?.duplicate
                        ? "Duplicate"
                        : undefined
                    }
                    onChange={(e) => updateRow(index, { name: e.currentTarget.value })}
                  />
                  <Checkbox
                    label="Required"
                    size="xs"
                    checked={variable.required ?? false}
                    onChange={(e) =>
                      updateRow(index, { required: e.currentTarget.checked })
                    }
                  />
                  <Tooltip label="Remove">
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      size="lg"
                      onClick={() => removeRow(index)}
                    >
                      ×
                    </ActionIcon>
                  </Tooltip>
                </Group>
                <TextInput
                  label="Description"
                  placeholder="What does this variable hold?"
                  size="xs"
                  value={variable.description ?? ""}
                  onChange={(e) =>
                    updateRow(index, {
                      description: e.currentTarget.value || null,
                    })
                  }
                />
                <TextInput
                  label="Default value"
                  placeholder="Used when SDK omits this variable"
                  size="xs"
                  value={variable.defaultValue ?? ""}
                  onChange={(e) =>
                    updateRow(index, {
                      defaultValue: e.currentTarget.value || null,
                    })
                  }
                />
                {meta?.unreferenced && variable.name.trim().length > 0 && (
                  <Text size="xs" c="orange.7">
                    Declared but not referenced in the body.
                  </Text>
                )}
              </Stack>
            );
          })}
        </Stack>
      )}
    </Stack>
  );
};

// Pure validation helper for callers that want to gate "save" on a clean
// variable list. Returns null when valid, an error string when not.
export const validateVariableList = (
  variables: readonly PromptVariableInput[],
): string | null => {
  const seen = new Set<string>();
  for (let i = 0; i < variables.length; i += 1) {
    const v = variables[i];
    if (!v) continue;
    const name = v.name.trim();
    if (name.length === 0) {
      return `Variable #${i + 1} has no name`;
    }
    if (!isValidVariableName(name)) {
      return `Variable "${v.name}" has an invalid name`;
    }
    if (seen.has(name)) {
      return `Duplicate variable name: "${name}"`;
    }
    seen.add(name);
  }
  return null;
};
