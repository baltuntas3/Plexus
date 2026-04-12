import type {
  CreateUserInput,
  IUserRepository,
} from "../../domain/repositories/user-repository.js";
import type { User } from "../../domain/entities/user.js";

export class InMemoryUserRepository implements IUserRepository {
  private readonly users = new Map<string, User>();
  private nextId = 1;

  async findById(id: string): Promise<User | null> {
    return this.users.get(id) ?? null;
  }

  async findByEmail(email: string): Promise<User | null> {
    for (const user of this.users.values()) {
      if (user.email === email.toLowerCase()) return user;
    }
    return null;
  }

  async create(input: CreateUserInput): Promise<User> {
    const now = new Date();
    const id = String(this.nextId++);
    const user: User = {
      id,
      email: input.email.toLowerCase(),
      name: input.name,
      passwordHash: input.passwordHash,
      createdAt: now,
      updatedAt: now,
    };
    this.users.set(id, user);
    return user;
  }
}
