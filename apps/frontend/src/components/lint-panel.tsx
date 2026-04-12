import {
  Accordion,
  Badge,
  Box,
  Center,
  Group,
  List,
  Paper,
  Progress,
  RingProgress,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import type { GraphQualityScoreDto, LintSeverity } from "@plexus/shared-types";

interface LintPanelProps {
  qualityScore: GraphQualityScoreDto;
}

const scoreColor = (score: number): string => {
  if (score >= 80) return "green";
  if (score >= 50) return "yellow";
  return "red";
};

const severityColor: Record<LintSeverity, string> = {
  info: "blue",
  warning: "yellow",
  error: "red",
};

export const LintPanel = ({ qualityScore }: LintPanelProps) => {
  const overall = Math.round(qualityScore.overall);

  return (
    <Paper withBorder p="md">
      <Stack>
        <Group justify="space-between" align="flex-start">
          <div>
            <Title order={4}>Graph Quality</Title>
            <Text size="xs" c="dimmed">
              Scores reflect adherence to BRAID paper §A.4 principles.
            </Text>
          </div>
          <Center>
            <RingProgress
              size={90}
              thickness={10}
              sections={[{ value: overall, color: scoreColor(overall) }]}
              label={
                <Text ta="center" fw={700} size="lg">
                  {overall}
                </Text>
              }
            />
          </Center>
        </Group>

        <Stack gap="xs">
          {qualityScore.results.map((r) => (
            <Box key={r.ruleId}>
              <Group justify="space-between" mb={2}>
                <Group gap="xs">
                  <Text size="sm" fw={500}>
                    {r.displayName}
                  </Text>
                  {r.issues.length > 0 && (
                    <Badge color="red" size="xs" circle>
                      {r.issues.length}
                    </Badge>
                  )}
                </Group>
                <Text size="sm" c="dimmed">
                  {Math.round(r.score)}
                </Text>
              </Group>
              <Progress value={r.score} color={scoreColor(r.score)} size="sm" />
            </Box>
          ))}
        </Stack>

        {qualityScore.results.some((r) => r.issues.length > 0) && (
          <Accordion variant="separated">
            {qualityScore.results
              .filter((r) => r.issues.length > 0)
              .map((r) => (
                <Accordion.Item key={r.ruleId} value={r.ruleId}>
                  <Accordion.Control>
                    <Group justify="space-between">
                      <Text size="sm">{r.displayName}</Text>
                      <Badge size="xs">{r.issues.length}</Badge>
                    </Group>
                  </Accordion.Control>
                  <Accordion.Panel>
                    <List size="sm" spacing="xs">
                      {r.issues.map((issue, idx) => (
                        <List.Item key={`${issue.ruleId}-${idx}`}>
                          <Group gap="xs" align="flex-start">
                            <Badge color={severityColor[issue.severity]} size="xs">
                              {issue.severity}
                            </Badge>
                            <Text size="sm">{issue.message}</Text>
                          </Group>
                        </List.Item>
                      ))}
                    </List>
                  </Accordion.Panel>
                </Accordion.Item>
              ))}
          </Accordion>
        )}
      </Stack>
    </Paper>
  );
};
