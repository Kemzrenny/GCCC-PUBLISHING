import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

// Encrypts small secrets (the Google Drive refresh token) before they go in the database,
// with a key derived from JWT_SECRET. Changing JWT_SECRET means reconnecting Google Drive.

function key(): Buffer {
  const secret = process.env.JWT_SECRET;
  if (!secret && process.env.NODE_ENV === "production") throw new Error("JWT_SECRET must be set.");
  return createHash("sha256").update(`gccc-secret-box:${secret ?? "dev-secret-change-me"}`).digest();
}

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString("base64url")).join(".");
}

export function open(sealed: string): string | null {
  try {
    const [iv, tag, body] = sealed.split(".").map((p) => Buffer.from(p, "base64url"));
    const decipher = createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
