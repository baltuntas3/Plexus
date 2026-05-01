import { useMemo } from "react";
import { Center, Loader, Text } from "@mantine/core";
import { useAtomValue } from "jotai";
import { Navigate, useParams } from "react-router-dom";
import { loadable } from "jotai/utils";
import { getPromptDetailAtom } from "../atoms/prompts.atoms.js";
import { ApiError } from "../lib/api-client.js";

// /prompts/:id is a thin landing route. The real prompt UI is the version
// editor at /prompts/:id/versions/:version. Production is preferred so the
// page lands on the live version; otherwise we fall back to the most
// recently created version. An empty prompt (no versions yet) routes to
// the new-version editor.
const PromptRedirect = ({ promptId }: { promptId: string }) => {
  const detailAtom = useMemo(
    () => loadable(getPromptDetailAtom(promptId)),
    [promptId],
  );
  const detail = useAtomValue(detailAtom);

  if (detail.state === "loading") {
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );
  }
  if (detail.state === "hasError") {
    const message =
      detail.error instanceof ApiError ? detail.error.message : "Failed to load prompt";
    return <Text c="red">{message}</Text>;
  }

  const { prompt, versions } = detail.data;
  if (versions.length === 0) {
    return <Navigate to={`/prompts/${prompt.id}/versions/new`} replace />;
  }
  const sorted = [...versions].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const target = prompt.productionVersion ?? sorted[0]!.version;
  return <Navigate to={`/prompts/${prompt.id}/versions/${target}`} replace />;
};

export const PromptDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  if (!id) return <Text>Invalid route</Text>;
  return <PromptRedirect promptId={id} />;
};
