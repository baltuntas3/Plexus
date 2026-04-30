import type { DomainError } from "../../domain/errors/domain-error.js";

// Mirrors the optimistic-concurrency check that every Mongo aggregate repo
// performs at the persistence boundary. Fake repos use it instead of
// re-implementing the same comparison so unit tests catch the same stale-
// write edges that production would surface as a Mongo `matchedCount === 0`.
export const assertOptimisticConcurrency = (
  storedRevision: number | undefined,
  expectedRevision: number,
  staleError: () => DomainError,
): void => {
  if (expectedRevision === 0) {
    if (storedRevision !== undefined) {
      throw staleError();
    }
    return;
  }
  if (storedRevision !== expectedRevision) {
    throw staleError();
  }
};
