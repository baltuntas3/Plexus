import type { IUnitOfWork } from "../../domain/services/unit-of-work.js";

// Pass-through UoW for unit tests. Real transaction semantics are tested
// against the Mongo adapter; application-layer tests only care that the
// use case invokes the boundary once around its write sequence, and a
// no-op fulfills that contract without the overhead of a real Mongo
// session.
export class NoOpUnitOfWork implements IUnitOfWork {
  async run<T>(work: () => Promise<T>): Promise<T> {
    return work();
  }
}
