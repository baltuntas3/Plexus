import { Schema, model, type InferSchemaType } from "mongoose";

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    name: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true },
  },
  { timestamps: true },
);

export type UserDocType = InferSchemaType<typeof userSchema> & { _id: unknown };

export const UserModel = model("User", userSchema);
