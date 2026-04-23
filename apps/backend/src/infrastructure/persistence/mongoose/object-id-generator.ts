import { Types } from "mongoose";
import type { IIdGenerator } from "../../../domain/services/id-generator.js";

export class MongoObjectIdGenerator implements IIdGenerator {
  newId(): string {
    return new Types.ObjectId().toString();
  }
}
