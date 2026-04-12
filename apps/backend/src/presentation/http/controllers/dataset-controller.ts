import type { Request, RequestHandler, Response } from "express";
import {
  addTestCasesSchema,
  createDatasetSchema,
  generateDatasetSchema,
  listDatasetsQuerySchema,
} from "../../../application/dto/dataset-dto.js";
import { UnauthorizedError, ValidationError } from "../../../domain/errors/domain-error.js";
import type { DatasetComposition } from "../../../composition/dataset-composition.js";
import { toDatasetDetailDto, toDatasetDto } from "../mappers/dataset-mappers.js";

const requireUserId = (req: Request): string => {
  if (!req.userId) throw UnauthorizedError();
  return req.userId;
};

const requireParam = (req: Request, name: string): string => {
  const value = req.params[name];
  if (!value) throw ValidationError(`Missing path parameter: ${name}`);
  return value;
};

export class DatasetController {
  constructor(private readonly datasets: DatasetComposition) {}

  create: RequestHandler = async (req: Request, res: Response) => {
    const ownerId = requireUserId(req);
    const input = createDatasetSchema.parse(req.body);
    const dataset = await this.datasets.createDataset.execute({ ...input, ownerId });
    res.status(201).json({ dataset: toDatasetDetailDto(dataset) });
  };

  list: RequestHandler = async (req: Request, res: Response) => {
    const ownerId = requireUserId(req);
    const query = listDatasetsQuerySchema.parse(req.query);
    const result = await this.datasets.listDatasets.execute({ ...query, ownerId });
    res.json({
      items: result.items.map(toDatasetDto),
      total: result.total,
      page: query.page,
      pageSize: query.pageSize,
    });
  };

  get: RequestHandler = async (req: Request, res: Response) => {
    const ownerId = requireUserId(req);
    const id = requireParam(req, "id");
    const dataset = await this.datasets.getDataset.execute({ datasetId: id, ownerId });
    res.json({ dataset: toDatasetDetailDto(dataset) });
  };

  remove: RequestHandler = async (req: Request, res: Response) => {
    const ownerId = requireUserId(req);
    const id = requireParam(req, "id");
    await this.datasets.deleteDataset.execute({ datasetId: id, ownerId });
    res.status(204).end();
  };

  addTestCases: RequestHandler = async (req: Request, res: Response) => {
    const ownerId = requireUserId(req);
    const id = requireParam(req, "id");
    const input = addTestCasesSchema.parse(req.body);
    const dataset = await this.datasets.addTestCases.execute({
      ...input,
      datasetId: id,
      ownerId,
    });
    res.json({ dataset: toDatasetDetailDto(dataset) });
  };

  generate: RequestHandler = async (req: Request, res: Response) => {
    const ownerId = requireUserId(req);
    const input = generateDatasetSchema.parse(req.body);
    const result = await this.datasets.generateDataset.execute({ ...input, ownerId });
    res.status(201).json({
      dataset: toDatasetDetailDto(result.dataset),
      model: result.model,
      generatedCount: result.generatedCount,
    });
  };

  removeTestCase: RequestHandler = async (req: Request, res: Response) => {
    const ownerId = requireUserId(req);
    const id = requireParam(req, "id");
    const testCaseId = requireParam(req, "testCaseId");
    const dataset = await this.datasets.removeTestCase.execute({
      datasetId: id,
      testCaseId,
      ownerId,
    });
    res.json({ dataset: toDatasetDetailDto(dataset) });
  };
}
