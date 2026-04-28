import mongoose from "mongoose";
import type { IUnitOfWork } from "../../../domain/services/unit-of-work.js";
import { runWithSession } from "./transaction-context.js";

// Mongo-backed UoW. Starts a session, propagates it through AsyncLocalStorage,
// and delegates retry/abort semantics to `session.withTransaction` — that
// driver-level helper handles TransientTransactionError retries so use cases
// do not reimplement the loop.
//
// Requires a MongoDB deployment that supports multi-document transactions
// (replica set or sharded cluster). On a standalone `mongod` this will fail
// at the first write inside the transaction; that failure is a deployment
// signal, not a code bug — the previous non-atomic behavior silently masked
// partial-write inconsistencies and that is exactly what this port closes.
export class MongoUnitOfWork implements IUnitOfWork {
  async run<T>(work: () => Promise<T>): Promise<T> {
    const session = await mongoose.startSession();
    try {
      let captured: { value: T } | undefined;
      await session.withTransaction(async () => {
        // withTransaction may re-invoke the callback on transient errors;
        // the latest attempt wins and prior captured values are discarded.
        captured = undefined;
        const value = await runWithSession(session, work);
        captured = { value };
      });
      if (!captured) {
        throw new Error("UnitOfWork completed without capturing a result");
      }
      return captured.value;
    } finally {
      await session.endSession();
    }
  }
}
