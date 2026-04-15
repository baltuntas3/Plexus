import { Suspense, useEffect, useState } from "react";
import {
  Button,
  Center,
  Loader,
  Modal,
  MultiSelect,
  NumberInput,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { useAtomValue, useSetAtom } from "jotai";
import { useNavigate } from "react-router-dom";
import type { Paginated, PromptDto, PromptVersionDto } from "@plexus/shared-types";
import { createBenchmarkAtom } from "../atoms/benchmarks.atoms.js";
import { modelsAtom } from "../atoms/models.atoms.js";
import { promptsListAtom } from "../atoms/prompts.atoms.js";
import { tokensAtom } from "../atoms/auth.atoms.js";
import { apiRequest, ApiError } from "../lib/api-client.js";

interface NewBenchmarkModalProps {
  opened: boolean;
  onClose: () => void;
}

export const NewBenchmarkModal = ({ opened, onClose }: NewBenchmarkModalProps) => {
  return (
    <Modal opened={opened} onClose={onClose} title="New Benchmark" size="lg">
      <Suspense
        fallback={
          <Center py="xl">
            <Loader />
          </Center>
        }
      >
        <NewBenchmarkForm onClose={onClose} />
      </Suspense>
    </Modal>
  );
};

const NewBenchmarkForm = ({ onClose }: { onClose: () => void }) => {
  const prompts = useAtomValue(promptsListAtom);
  const models = useAtomValue(modelsAtom);
  const tokens = useAtomValue(tokensAtom);
  const createBenchmark = useSetAtom(createBenchmarkAtom);
  const navigate = useNavigate();

  const [versions, setVersions] = useState<PromptVersionDto[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm({
    initialValues: {
      name: "",
      promptId: "",
      promptVersionIds: [] as string[],
      solverModels: [] as string[],
      judgeModel: "",
      generatorModel: "",
      testCount: 10,
      concurrency: 2,
    },
    validate: {
      name: (v) => (v.trim().length >= 1 ? null : "Name is required"),
      promptVersionIds: (v) => (v.length > 0 ? null : "Pick at least one version"),
      solverModels: (v) => (v.length > 0 ? null : "Pick at least one solver model"),
      judgeModel: (v) => (v ? null : "Pick a judge model"),
      generatorModel: (v) => (v ? null : "Pick a generator model"),
      testCount: (v) => (v >= 1 && v <= 100 ? null : "Between 1 and 100"),
    },
  });

  useEffect(() => {
    const promptId = form.values.promptId;
    if (!promptId || !tokens) {
      setVersions([]);
      form.setFieldValue("promptVersionIds", []);
      return;
    }
    setVersionsLoading(true);
    apiRequest<Paginated<PromptVersionDto>>(
      `/prompts/${promptId}/versions?pageSize=100`,
      { token: tokens.accessToken },
    )
      .then((res) => {
        setVersions(res.items);
        form.setFieldValue("promptVersionIds", []);
      })
      .catch((err) => {
        const message = err instanceof ApiError ? err.message : "Failed to load versions";
        notifications.show({ color: "red", title: "Error", message });
      })
      .finally(() => setVersionsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.values.promptId, tokens?.accessToken]);

  const handleSubmit = async (values: typeof form.values) => {
    setSubmitting(true);
    try {
      const benchmark = await createBenchmark({
        name: values.name,
        promptVersionIds: values.promptVersionIds,
        solverModels: values.solverModels,
        judgeModel: values.judgeModel,
        generatorModel: values.generatorModel,
        testCount: values.testCount,
        concurrency: values.concurrency,
      });
      notifications.show({
        color: "green",
        title: "Test cases generated",
        message: `${benchmark.testCases.length} test cases ready — review and start when ready`,
      });
      form.reset();
      onClose();
      navigate(`/benchmarks/${benchmark.id}`);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Failed to create benchmark";
      notifications.show({ color: "red", title: "Error", message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={form.onSubmit(handleSubmit)}>
      <Stack>
        <TextInput
          label="Name"
          placeholder="e.g., Summarization v1 vs v2"
          {...form.getInputProps("name")}
        />

        <Select
          label="Prompt"
          placeholder="Pick a prompt to load its versions"
          searchable
          data={prompts.items.map((p: PromptDto) => ({ value: p.id, label: p.name }))}
          {...form.getInputProps("promptId")}
        />

        <MultiSelect
          label="Prompt Versions"
          placeholder={
            versionsLoading
              ? "Loading versions..."
              : versions.length === 0
                ? "Select a prompt first"
                : "Pick one or more versions"
          }
          disabled={versions.length === 0}
          data={versions.map((v) => ({ value: v.id, label: `v${v.version}` }))}
          {...form.getInputProps("promptVersionIds")}
        />

        <MultiSelect
          label="Solver Models"
          placeholder="Pick one or more solver models"
          searchable
          data={models.map((m) => ({ value: m.id, label: m.displayName }))}
          {...form.getInputProps("solverModels")}
        />

        <Select
          label="Judge Model"
          placeholder="Pick a judge model"
          searchable
          data={models.map((m) => ({ value: m.id, label: m.displayName }))}
          {...form.getInputProps("judgeModel")}
        />

        <Select
          label="Generator Model"
          description="Model that creates test inputs from your prompt"
          placeholder="Pick a generator model"
          searchable
          data={models.map((m) => ({ value: m.id, label: m.displayName }))}
          {...form.getInputProps("generatorModel")}
        />

        <NumberInput
          label="Test Case Count"
          description="How many test inputs to generate"
          min={1}
          max={100}
          {...form.getInputProps("testCount")}
        />

        <NumberInput
          label="Concurrency"
          min={1}
          max={16}
          {...form.getInputProps("concurrency")}
        />

        {submitting && (
          <Text size="sm" c="dimmed" ta="center">
            Generating test cases, this may take a few seconds...
          </Text>
        )}

        <Button type="submit" loading={submitting}>
          Generate Test Cases
        </Button>
      </Stack>
    </form>
  );
};
