import type { IUserRepository } from "../../../domain/repositories/user-repository.js";
import { NotFoundError } from "../../../domain/errors/domain-error.js";
import { toPublicUser, type PublicUser } from "../../../domain/entities/user.js";

export class GetCurrentUserUseCase {
  constructor(private readonly users: IUserRepository) {}

  async execute(userId: string): Promise<PublicUser> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw NotFoundError("User not found");
    }
    return toPublicUser(user);
  }
}
