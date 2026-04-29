import { createHash, randomBytes } from "node:crypto";

// Invitation token cryptography. Plain text is generated once at issue
// time and handed to the recipient out-of-band (email link); only its
// SHA-256 hash is persisted. Redemption flow hashes the incoming token
// and looks up by hash, so a database leak does not yield usable links.
//
// SHA-256 (not bcrypt/argon2) is intentional: tokens are 32 random bytes
// already (~256 bits of entropy) and the lookup must be exact-match
// indexed. A salted slow hash adds no security here and would break the
// `findByTokenHash` index path.

// 32 bytes → 64 hex chars. Long enough that brute-force is infeasible
// even with a global secondary index; short enough to fit in a URL.
const TOKEN_BYTES = 32;

export interface InvitationToken {
  plaintext: string;
  hash: string;
}

export const generateInvitationToken = (): InvitationToken => {
  const plaintext = randomBytes(TOKEN_BYTES).toString("hex");
  return { plaintext, hash: hashInvitationToken(plaintext) };
};

export const hashInvitationToken = (plaintext: string): string =>
  createHash("sha256").update(plaintext).digest("hex");
