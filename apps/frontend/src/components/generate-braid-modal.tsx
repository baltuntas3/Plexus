import { Suspense, useEffect, useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Group,
  Loader,
  Modal,
  Select,
  Stack,
  Text,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useAtomValue, useSetAtom } from "jotai";
import { generateBraidAtom, modelsAtom } from "../atoms/braid.atoms.js";
import { ApiError } from "../lib/api-client.js";

interface GenerateBraidModalProps {
  opened: boolean;
  onClose: () => void;
  promptId: string;
  version: string;
}

const ModelPicker = ({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
}) => {
  const models = useAtomValue(modelsAtom);
  return (
    <Select
      label="Generator model"
      placeholder="Select model"
      value={value}
      onChange={onChange}
      data={models.map((m) => ({
        value: m.id,
        label: `${m.displayName} ($${m.inputPricePerMillion}/$${m.outputPricePerMillion} per 1M)`,
      }))}
      searchable
    />
  );
};

export const GenerateBraidModal = ({
  opened,
  onClose,
  promptId,
  version,
}: GenerateBraidModalProps) => {
  const generate = useSetAtom(generateBraidAtom);
  const [model, setModel] = useState<string | null>(null);
  const [force, setForce] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!opened) {
      setLoading(false);
      setForce(false);
    }
  }, [opened]);

  const handleGenerate = async () => {
    if (!model) {
      notifications.show({ color: "yellow", title: "Model required", message: "Pick a generator model" });
      return;
    }
    setLoading(true);
    try {
      const result = await generate({
        promptId,
        version,
        input: { generatorModel: model, forceRegenerate: force },
      });
      notifications.show({
        color: "green",
        title: result.cached ? "Cache hit" : "Generated",
        message: `${result.graph.nodes.length} nodes · $${result.usage.totalUsd.toFixed(4)}`,
      });
      onClose();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Failed to generate";
      notifications.show({ color: "red", title: "Error", message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Generate BRAID" size="md">
      <Stack>
        <Alert color="blue" variant="light">
          Generates a Mermaid reasoning graph from the classical prompt. Reuses cache unless "force"
          is set.
        </Alert>
        <Suspense
          fallback={
            <Group>
              <Loader size="sm" />
              <Text size="sm">Loading models...</Text>
            </Group>
          }
        >
          <ModelPicker value={model} onChange={setModel} />
        </Suspense>
        <Checkbox
          label="Force regenerate (bypass cache)"
          checked={force}
          onChange={(e) => setForce(e.currentTarget.checked)}
        />
        <Group justify="flex-end">
          <Button variant="subtle" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleGenerate} loading={loading}>
            Generate
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};
