// Domain port for identifier allocation. Consumed by application use cases
// (not by aggregates themselves) so domain entities stay free of service
// dependencies and can be constructed in pure unit tests with plain strings.
// Implementations live in infrastructure (Mongo ObjectId) and tests
// (deterministic sequence).
export interface IIdGenerator {
  newId(): string;
}
