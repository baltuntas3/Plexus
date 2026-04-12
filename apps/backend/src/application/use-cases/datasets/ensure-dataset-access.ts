import type { IDatasetRepository } from "../../../domain/repositories/dataset-repository.js";
import type { Dataset } from "../../../domain/entities/dataset.js";
import { ForbiddenError, NotFoundError } from "../../../domain/errors/domain-error.js";

export const ensureDatasetAccess = async (
  datasets: IDatasetRepository,
  datasetId: string,
  ownerId: string,
): Promise<Dataset> => {
  const dataset = await datasets.findById(datasetId);
  if (!dataset) {
    throw NotFoundError("Dataset not found");
  }
  if (dataset.ownerId !== ownerId) {
    throw ForbiddenError("You don't own this dataset");
  }
  return dataset;
};
