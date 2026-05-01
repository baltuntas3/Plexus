import { Suspense, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Checkbox,
  Group,
  Loader,
  MultiSelect,
  NumberInput,
  Paper,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useAtomValue, useSetAtom } from "jotai";
import { useNavigate } from "react-router-dom";
import type { PromptVersionDto } from "@plexus/shared-types";
import { modelsAtom } from "../atoms/braid.atoms.js";
import {
  benchmarksListRefreshAtom,
  createBenchmarkAtom,
} from "../atoms/benchmarks.atoms.js";
import { DEFAULT_TEST_COUNT } from "../lib/evaluate-presets.js";
import { ApiError } from "../lib/api-client.js";
import { PastEvaluationsList } from "./past-evaluations-list.js";

interface EvaluatePanelProps {
  currentVersion: PromptVersionDto;
  versions: PromptVersionDto[];
  promptName: string;
  productionVersionName: string | null;
}

const SolverMultiSelect = ({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
}) => {
  const models = useAtomValue(modelsAtom);
  return (
    <MultiSelect
      label="Solver models"
      description="Models that will answer each test case. Picked head-to-head."
      placeholder="Pick one or more models"
      value={value}
      onChange={onChange}
      data={models.map((m) => ({
        value: m.id,
        label: `${m.displayName} ($${m.inputPricePerMillion}/$${m.outputPricePerMillion}/1M)`,
      }))}
      searchable
      clearable
    />
  );
};

export const EvaluatePanel = ({
  currentVersion,
  versions,
  promptName,
  productionVersionName,
}: EvaluatePanelProps) => {
  const createBenchmark = useSetAtom(createBenchmarkAtom);
  // Bumped after a successful create so the Past Evaluations list below
  // re-fetches without a full page navigation. The user typically navigates
  // to the new benchmark detail anyway, but bumping covers the case where
  // they cancel out and return.
  const bumpBenchmarkListRefresh = useSetAtom(benchmarksListRefreshAtom);
  const navigate = useNavigate();

  const defaultVersionIds = useMemo(() => {
    const ids = new Set<string>([currentVersion.id]);
    if (productionVersionName) {
      const production = versions.find((v) => v.version === productionVersionName);
      if (production && production.id !== currentVersion.id) {
        ids.add(production.id);
      }
    }
    return Array.from(ids);
  }, [currentVersion.id, productionVersionName, versions]);

  const [selectedVersionIds, setSelectedVersionIds] = useState<string[]>(defaultVersionIds);
  const [solverModels, setSolverModels] = useState<string[]>([]);
  const [testCount, setTestCount] = useState<number>(DEFAULT_TEST_COUNT);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setSelectedVersionIds(defaultVersionIds);
  }, [defaultVersionIds]);

  const toggleVersion = (id: string, checked: boolean) => {
    setSelectedVersionIds((prev) => {
      if (checked) return prev.includes(id) ? prev : [...prev, id];
      return prev.filter((x) => x !== id);
    });
  };

  const handleStart = async () => {
    if (selectedVersionIds.length === 0) {
      notifications.show({
        color: "yellow",
        title: "Version required",
        message: "Pick at least one version to benchmark",
      });
      return;
    }
    if (solverModels.length === 0) {
      notifications.show({
        color: "yellow",
        title: "Model required",
        message: "Pick at least one solver model",
      });
      return;
    }
    if (!Number.isFinite(testCount) || testCount < 1 || testCount > 50) {
      notifications.show({
        color: "yellow",
        title: "Invalid test count",
        message: "Test case count must be between 1 and 50",
      });
      return;
    }

    setSubmitting(true);
    try {
      const benchmark = await createBenchmark({
        name: `${promptName} · ${solverModels.join(", ")} · ${testCount} cases`,
        promptVersionIds: selectedVersionIds,
        solverModels,
        testCount,
      });
      notifications.show({
        color: "green",
        title: "Evaluation ready",
        message: `${benchmark.testCases.length} test cases generated for ${selectedVersionIds.length} version(s)`,
      });
      bumpBenchmarkListRefresh((n) => n + 1);
      navigate(`/benchmarks/${benchmark.id}`, {
        state: {
          returnTo: `/prompts/${currentVersion.promptId}/versions/${currentVersion.version}`,
        },
      });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Failed to create evaluation";
      notifications.show({ color: "red", title: "Error", message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Stack gap="md">
      <Paper withBorder p="lg">
        <Stack gap="md">
          <div>
            <Title order={4}>Evaluate Versions</Title>
            <Text size="sm" c="dimmed">
              Pick which versions to compare, which models to evaluate as solvers, and how many
              test cases to generate. Judges, generator, generation mode, analysis model,
              repetitions and seed are chosen server-side to keep the comparison fair.
            </Text>
          </div>

          <Stack gap={4}>
            <Text size="sm" fw={500}>
              Versions
            </Text>
            <Text size="xs" c="dimmed">
              Select one or more versions of this prompt to benchmark head-to-head.
            </Text>
            <Stack gap={4} mt={4}>
              {versions.map((v) => {
                const isProduction = v.version === productionVersionName;
                const isCurrent = v.id === currentVersion.id;
                return (
                  <Checkbox
                    key={v.id}
                    size="sm"
                    checked={selectedVersionIds.includes(v.id)}
                    onChange={(e) => toggleVersion(v.id, e.currentTarget.checked)}
                    label={
                      <Group gap={6}>
                        <Text size="sm">{v.version}</Text>
                        {isCurrent && <Badge size="xs" color="blue">current</Badge>}
                        {isProduction && <Badge size="xs" color="green">production</Badge>}
                        <Badge size="xs" color="gray" variant="light">
                          {v.braidGraph ? "BRAID" : "classical"}
                        </Badge>
                      </Group>
                    }
                  />
                );
              })}
            </Stack>
          </Stack>

          <Suspense fallback={<Loader size="xs" />}>
            <SolverMultiSelect value={solverModels} onChange={setSolverModels} />
          </Suspense>

          <NumberInput
            label="Test Case Count"
            description="The generator creates this many shared evaluation cases before you review/edit them."
            min={1}
            max={50}
            value={testCount}
            onChange={(value) => setTestCount(typeof value === "number" ? value : DEFAULT_TEST_COUNT)}
          />

          <Group justify="flex-end">
            <Button
              onClick={() => void handleStart()}
              loading={submitting}
              disabled={selectedVersionIds.length === 0 || solverModels.length === 0}
            >
              Generate Evaluation Cases
            </Button>
          </Group>
        </Stack>
      </Paper>

      <PastEvaluationsList
        promptVersionId={currentVersion.id}
        versions={versions}
      />
    </Stack>
  );
};
