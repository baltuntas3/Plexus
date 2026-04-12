export interface User {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
}

export type PublicUser = Omit<User, "passwordHash">;

export const toPublicUser = (user: User): PublicUser => {
  const { passwordHash: _passwordHash, ...rest } = user;
  return rest;
};
