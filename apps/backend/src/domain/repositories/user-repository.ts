import type { User } from "../entities/user.js";

export interface CreateUserInput {
  email: string;
  name: string;
  passwordHash: string;
}

export interface IUserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  create(input: CreateUserInput): Promise<User>;
}
