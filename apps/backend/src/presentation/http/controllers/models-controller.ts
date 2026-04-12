import type { Request, RequestHandler, Response } from "express";
import type { ModelInfoDto, ModelListResponse } from "@plexus/shared-types";
import { ModelRegistry } from "../../../application/services/model-registry.js";

const toDto = (model: ReturnType<typeof ModelRegistry.list>[number]): ModelInfoDto => ({
  id: model.id,
  provider: model.provider,
  displayName: model.displayName,
  inputPricePerMillion: model.inputPricePerMillion,
  outputPricePerMillion: model.outputPricePerMillion,
});

export class ModelsController {
  list: RequestHandler = async (_req: Request, res: Response) => {
    const items: ModelInfoDto[] = ModelRegistry.list().map(toDto);
    const response: ModelListResponse = { items };
    res.json(response);
  };
}
