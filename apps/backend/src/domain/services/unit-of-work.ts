// Transactional boundary port for use cases that mutate more than one
// aggregate. Use cases wrap their multi-write critical section in
// `uow.run(...)`; the infrastructure adapter decides how that boundary is
// enforced (Mongo session + withTransaction in production, a pass-through
// in unit tests that do not need real isolation).
//
// Keeping this as a domain port — not a Mongoose-specific helper — means
// application code never learns what a ClientSession is and cannot leak
// persistence primitives into use-case signatures.
export interface IUnitOfWork {
  run<T>(work: () => Promise<T>): Promise<T>;
}
