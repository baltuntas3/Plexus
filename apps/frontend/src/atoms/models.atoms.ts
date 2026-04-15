import { atom } from "jotai";
import type { ModelInfoDto, ModelListResponse } from "@plexus/shared-types";
import { apiRequest } from "../lib/api-client.js";
import { tokensAtom } from "./auth.atoms.js";

export const modelsAtom = atom(async (get): Promise<ModelInfoDto[]> => {
  const tokens = get(tokensAtom);
  if (!tokens) return [];
  const result = await apiRequest<ModelListResponse>("/models", {
    token: tokens.accessToken,
  });
  return result.items;
});
