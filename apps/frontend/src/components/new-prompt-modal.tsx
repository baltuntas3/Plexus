import { useState } from "react";
import { Button, Modal, Select, Stack, Textarea, TextInput } from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { useSetAtom } from "jotai";
import { useNavigate } from "react-router-dom";
import { TASK_TYPES, type TaskType } from "@plexus/shared-types";
import { createPromptAtom } from "../atoms/prompts.atoms.js";
import { ApiError } from "../lib/api-client.js";

interface NewPromptModalProps {
  opened: boolean;
  onClose: () => void;
}

export const NewPromptModal = ({ opened, onClose }: NewPromptModalProps) => {
  const createPrompt = useSetAtom(createPromptAtom);
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

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

  const handleSubmit = async (values: typeof form.values) => {
    setLoading(true);
    try {
      const { prompt } = await createPrompt(values);
      notifications.show({ color: "green", title: "Created", message: `Prompt "${prompt.name}" created` });
      form.reset();
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
            placeholder="Classical prompt text..."
            autosize
            minRows={6}
            {...form.getInputProps("initialPrompt")}
          />
          <Button type="submit" loading={loading}>
            Create
          </Button>
        </Stack>
      </form>
    </Modal>
  );
};
