import bcrypt from "bcrypt";
import type { IPasswordHasher } from "../../application/services/password-hasher.js";

const SALT_ROUNDS = 12;

export class BcryptPasswordHasher implements IPasswordHasher {
  async hash(plain: string): Promise<string> {
    return bcrypt.hash(plain, SALT_ROUNDS);
  }

  async verify(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  }
}
