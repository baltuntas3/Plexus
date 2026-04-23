// Aggregate-owned identifier generation is a domain concern, not a
// repository one: aggregates must be constructable without a persistence
// dependency, and use cases should not pre-allocate IDs that the aggregate
// may or may not consume (wasted-id smell).
export interface IIdGenerator {
  newId(): string;
}
