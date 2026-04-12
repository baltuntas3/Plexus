import type { HydratedDocument } from "mongoose";
import type {
  CreateUserInput,
  IUserRepository,
} from "../../../domain/repositories/user-repository.js";
import type { User } from "../../../domain/entities/user.js";
import { UserModel } from "./user-model.js";

type UserDoc = HydratedDocument<{
  email: string;
  name: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
}>;

const toDomain = (doc: UserDoc): User => ({
  id: String(doc._id),
  email: doc.email,
  name: doc.name,
  passwordHash: doc.passwordHash,
  createdAt: doc.createdAt,
  updatedAt: doc.updatedAt,
});

export class MongoUserRepository implements IUserRepository {
  async findById(id: string): Promise<User | null> {
    const doc = await UserModel.findById(id);
    return doc ? toDomain(doc as unknown as UserDoc) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const doc = await UserModel.findOne({ email: email.toLowerCase() });
    return doc ? toDomain(doc as unknown as UserDoc) : null;
  }

  async create(input: CreateUserInput): Promise<User> {
    const doc = await UserModel.create(input);
    return toDomain(doc as unknown as UserDoc);
  }
}
