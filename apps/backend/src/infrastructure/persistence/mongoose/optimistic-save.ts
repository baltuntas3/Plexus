import type { Model } from "mongoose";

// `AnyModel` is the narrowest type that lets every concrete Mongoose model
// flow through this helper. Mongoose's per-schema generic on Model means
// `Model<unknown>` rejects each model's specific schema generic; the only
// alternative is to spell `<TSchema, ...>` at every call site, which leaks
// persistence types into the repositories that this helper exists to
// simplify. The `any` is contained to this single adapter file — it does
// not appear in any domain or application signature.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyModel = Model<any>;
import type { DomainError } from "../../../domain/errors/domain-error.js";
import { isDuplicateKeyError } from "./mongo-errors.js";
import { getCurrentSession } from "./transaction-context.js";

// Aggregate that participates in the snapshot/markPersisted protocol used
// by every write aggregate in the codebase. Repository helper takes the
// snapshot, gates the write on `expectedRevision`, and advances the cursor
// only on a successful persist.
interface OptimisticAggregate<P> {
  toSnapshot(): { primitives: P; expectedRevision: number };
  markPersisted(): void;
}

// Extracts the snapshot's primitive shape from the aggregate type so callers
// don't have to spell `<Primitives, AggregateClass>` at every call site —
// inference flows from the `aggregate` argument alone.
type PrimitivesOf<A> = A extends OptimisticAggregate<infer P> ? P : never;

interface OptimisticSaveSpec<A extends OptimisticAggregate<unknown>> {
  aggregate: A;
  model: AnyModel;
  toCreateDoc: (primitives: PrimitivesOf<A>) => Record<string, unknown>;
  toUpdateSet: (primitives: PrimitivesOf<A>) => Record<string, unknown>;
  staleError: () => DomainError;
  // Translates a duplicate-key error into a domain-specific exception. If
  // the duplicate is on the aggregate's id (a "create after stale read"
  // race), return `null` so the caller falls back to `staleError()`.
  onDuplicateKey?: (err: unknown) => DomainError | null;
}

// Single shared implementation of "create on first write, optimistic-revision
// update on subsequent writes" that every Mongo aggregate repository was
// duplicating. Folds in the ambient transaction session so any caller that
// runs inside a UoW automatically picks it up — no per-repo `getCurrentSession`
// wiring.
export const runOptimisticSave = async <A extends OptimisticAggregate<unknown>>(
  spec: OptimisticSaveSpec<A>,
): Promise<void> => {
  const { primitives, expectedRevision } = spec.aggregate.toSnapshot();
  const session = getCurrentSession();
  const p = primitives as PrimitivesOf<A>;
  const id = (p as { id: string }).id;

  if (expectedRevision === 0) {
    try {
      await (spec.model as AnyModel).create(
        [spec.toCreateDoc(p)],
        { session },
      );
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        const mapped = spec.onDuplicateKey?.(err) ?? null;
        throw mapped ?? spec.staleError();
      }
      throw err;
    }
  } else {
    const result = await (spec.model as AnyModel).updateOne(
      { _id: id, revision: expectedRevision },
      { $set: spec.toUpdateSet(p) },
      { session },
    );
    if (result.matchedCount === 0) {
      throw spec.staleError();
    }
  }

  spec.aggregate.markPersisted();
};
