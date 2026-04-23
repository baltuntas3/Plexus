import type { IIdGenerator } from "../../domain/services/id-generator.js";

export class InMemoryIdGenerator implements IIdGenerator {
  private counter = 1;

  constructor(private readonly prefix = "id") {}

  newId(): string {
    return `${this.prefix}-${this.counter++}`;
  }
}
