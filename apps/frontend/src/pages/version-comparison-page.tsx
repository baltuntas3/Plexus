import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  Center,
  Group,
  Loader,
  Paper,
  Stack,
  Tabs,
  Text,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { DiffEditor } from "@monaco-editor/react";
import { useSetAtom } from "jotai";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import type {
  VersionComparisonDto,
  VersionStatus,
} from "@plexus/shared-types";
import { compareVersionsAtom } from "../atoms/prompts.atoms.js";
import { MetricsPanel } from "../components/version-comparison-metrics-panel.js";
import { VariablesDiffPanel } from "../components/version-comparison-variables-panel.js";
import { ApiError } from "../lib/api-client.js";

const statusColor: Record<VersionStatus, string> = {
  draft: "gray",
  development: "blue",
  staging: "yellow",
  production: "green",
};

// Side-by-side comparison view. Body and Graph diffs render via Monaco
// DiffEditor (the graph is treated as plain mermaid text — structural
// graph diff is a follow-up). Variables tab consumes the server-
// computed `variablesDiff`. Metrics tab is a property-by-property
// table built from `base` / `target` directly.
export const VersionComparisonPage = () => {
  const { id } = useParams<{ id: string }>();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const compare = useSetAtom(compareVersionsAtom);

  const baseVersion = search.get("base");
  const targetVersion = search.get("target");

  const [comparison, setComparison] = useState<VersionComparisonDto | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id || !baseVersion || !targetVersion) return;
    let cancelled = false;
    setLoading(true);
    compare({ promptId: id, baseVersion, targetVersion })
      .then((res) => {
        if (!cancelled) setComparison(res);
      })
      .catch((err: unknown) => {
        const message = err instanceof ApiError ? err.message : "Failed to compare";
        notifications.show({ color: "red", title: "Error", message });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, baseVersion, targetVersion, compare]);

  if (!id || !baseVersion || !targetVersion) {
    return (
      <Text c="red">
        Missing comparison parameters. Expected /prompts/:id/compare?base=&target=
      </Text>
    );
  }
  if (loading) {
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );
  }
  if (!comparison) {
    return <Text c="dimmed">No comparison data</Text>;
  }

  const { base, target, variablesDiff } = comparison;
  const baseLabel = base.name?.trim() || base.version;
  const targetLabel = target.name?.trim() || target.version;

  return (
    <Stack>
      <Group justify="space-between">
        <div>
          <Title order={2}>Compare versions</Title>
          <Group gap="xs" mt={4}>
            <Badge color={statusColor[base.status]}>{baseLabel}</Badge>
            <Text size="sm" c="dimmed">
              vs
            </Text>
            <Badge color={statusColor[target.status]}>{targetLabel}</Badge>
          </Group>
        </div>
        <Button variant="subtle" onClick={() => navigate(`/prompts/${id}`)}>
          Back
        </Button>
      </Group>

      <Tabs defaultValue="body">
        <Tabs.List>
          <Tabs.Tab value="body">Body</Tabs.Tab>
          <Tabs.Tab value="graph">Graph</Tabs.Tab>
          <Tabs.Tab value="variables">
            Variables
            {variablesDiff.added.length
            + variablesDiff.removed.length
            + variablesDiff.changed.length >
              0 && (
              <Badge ml={6} size="xs" color="violet" variant="light">
                {variablesDiff.added.length
                  + variablesDiff.removed.length
                  + variablesDiff.changed.length}
              </Badge>
            )}
          </Tabs.Tab>
          <Tabs.Tab value="metrics">Metrics</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="body" pt="md">
          <Paper withBorder p={0} style={{ overflow: "hidden" }}>
            <DiffEditor
              height="65vh"
              original={base.sourcePrompt}
              modified={target.sourcePrompt}
              language="markdown"
              theme="vs-dark"
              options={{
                readOnly: true,
                minimap: { enabled: false },
                renderSideBySide: true,
                wordWrap: "on",
              }}
            />
          </Paper>
        </Tabs.Panel>

        <Tabs.Panel value="graph" pt="md">
          {!base.braidGraph && !target.braidGraph ? (
            <Center py="xl">
              <Text c="dimmed">Neither version has a BRAID graph</Text>
            </Center>
          ) : (
            <Paper withBorder p={0} style={{ overflow: "hidden" }}>
              <DiffEditor
                height="65vh"
                original={base.braidGraph ?? ""}
                modified={target.braidGraph ?? ""}
                language="plaintext"
                theme="vs-dark"
                options={{
                  readOnly: true,
                  minimap: { enabled: false },
                  renderSideBySide: true,
                  wordWrap: "on",
                }}
              />
            </Paper>
          )}
        </Tabs.Panel>

        <Tabs.Panel value="variables" pt="md">
          <VariablesDiffPanel diff={variablesDiff} />
        </Tabs.Panel>

        <Tabs.Panel value="metrics" pt="md">
          <MetricsPanel
            base={comparison.base}
            target={comparison.target}
            baseLabel={baseLabel}
            targetLabel={targetLabel}
          />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
};


