import { useMemo, useState } from "react";
import {
  Button,
  Collapse,
  Group,
  Modal,
  Select,
  Stack,
  Textarea,
  TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { useSetAtom } from "jotai";
import { useNavigate } from "react-router-dom";
import {
  TASK_TYPES,
  type PromptVariableInput,
  type TaskType,
} from "@plexus/shared-types";
import { createPromptAtom } from "../atoms/prompts.atoms.js";
import {
  VariablesPanel,
  validateVariableList,
} from "./variables-panel.js";
import { parseVariableReferences } from "../lib/parse-variable-references.js";
import { ApiError } from "../lib/api-client.js";

interface NewPromptModalProps {
  opened: boolean;
  onClose: () => void;
}

export const NewPromptModal = ({ opened, onClose }: NewPromptModalProps) => {
  const createPrompt = useSetAtom(createPromptAtom);
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [variables, setVariables] = useState<PromptVariableInput[]>([]);
  const [variablesOpen, setVariablesOpen] = useState(false);

  const form = useForm({
    initialValues: {
      name: "",
      description: "",
      taskType: "general" as TaskType,
      initialPrompt: "",
    },
    validate: {
      name: (v) => (v.trim().length >= 1 ? null : "Name is required"),
      initialPrompt: (v) => (v.trim().length >= 1 ? null : "Initial prompt is required"),
    },
  });

  const referenced = useMemo(
    () => parseVariableReferences(form.values.initialPrompt),
    [form.values.initialPrompt],
  );
  const declaredSet = useMemo(
    () => new Set(variables.map((v) => v.name.trim())),
    [variables],
  );
  const undeclared = useMemo(
    () => referenced.filter((n) => !declaredSet.has(n)),
    [referenced, declaredSet],
  );

  const reset = () => {
    form.reset();
    setVariables([]);
    setVariablesOpen(false);
  };

  const handleSubmit = async (values: typeof form.values) => {
    const variablesError = validateVariableList(variables);
    if (variablesError) {
      notifications.show({ color: "red", title: "Variables invalid", message: variablesError });
      return;
    }
    if (undeclared.length > 0) {
      notifications.show({
        color: "red",
        title: "Undeclared placeholders",
        message: `Add these to Variables: ${undeclared.map((n) => `{{${n}}}`).join(", ")}`,
      });
      return;
    }
    setLoading(true);
    try {
      const { prompt } = await createPrompt({
        ...values,
        ...(variables.length > 0
          ? {
              variables: variables.map((v) => ({
                name: v.name.trim(),
                description: v.description ?? null,
                defaultValue: v.defaultValue ?? null,
                required: v.required ?? false,
              })),
            }
          : {}),
      });
      notifications.show({ color: "green", title: "Created", message: `Prompt "${prompt.name}" created` });
      reset();
      onClose();
      navigate(`/prompts/${prompt.id}`);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Failed to create prompt";
      notifications.show({ color: "red", title: "Error", message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title="New Prompt" size="lg">
      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack>
          <TextInput label="Name" placeholder="e.g., Summarizer" {...form.getInputProps("name")} />
          <Textarea
            label="Description"
            placeholder="Short description (optional)"
            autosize
            minRows={2}
            {...form.getInputProps("description")}
          />
          <Select
            label="Task Type"
            data={TASK_TYPES.map((t) => ({ value: t, label: t }))}
            {...form.getInputProps("taskType")}
          />
          <Textarea
            label="Initial Prompt (v1)"
            placeholder="Classical prompt text. Reference variables with {{name}}."
            autosize
            minRows={6}
            {...form.getInputProps("initialPrompt")}
          />
          <Group justify="space-between">
            <Button
              variant="subtle"
              size="xs"
              onClick={() => setVariablesOpen((v) => !v)}
            >
              {variablesOpen ? "Hide" : "Show"} variables
              {variables.length > 0 ? ` (${variables.length})` : ""}
              {undeclared.length > 0 ? ` — ${undeclared.length} undeclared` : ""}
            </Button>
          </Group>
          <Collapse in={variablesOpen}>
            <VariablesPanel
              value={variables}
              onChange={setVariables}
              referenced={referenced}
            />
          </Collapse>
          <Button type="submit" loading={loading}>
            Create
          </Button>
        </Stack>
      </form>
    </Modal>
  );
};
