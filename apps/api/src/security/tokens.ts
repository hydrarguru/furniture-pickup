import { createHash, randomBytes } from "node:crypto";

/** 256-bit random token, base64url (43 chars). Only its hash is stored. */
export const newToken = () => randomBytes(32).toString("base64url");

/** Tokens are high-entropy, so a plain SHA-256 is enough (no salt or slow hash needed). */
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
