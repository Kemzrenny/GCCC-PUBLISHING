import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import jwt from "jsonwebtoken";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// Same approach as The Doer Life: a signed session cookie, checked against the database
// on every request so a disabled account or a changed password takes effect at once.

function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") throw new Error("JWT_SECRET must be set in production.");
  return "dev-secret-change-me";
}

const SESSION_COOKIE = "gccc_session";
const ACTIVE_REFRESH_MS = 10 * 60_000;

export type SessionUser = { id: string; name: string; email: string; role: Role };

export class AuthError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function setSessionCookie(userId: string) {
  const token = jwt.sign({ userId }, jwtSecret(), { expiresIn: "30d" });
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 30 * 24 * 60 * 60,
    path: "/",
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

async function readSession(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  let userId: string;
  let issuedAt: number | undefined;
  try {
    const payload = jwt.verify(token, jwtSecret()) as { userId: string; iat?: number };
    userId = payload.userId;
    issuedAt = payload.iat;
  } catch {
    return null;
  }
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true, disabledAt: true, lastActiveAt: true, passwordChangedAt: true },
  });
  if (!user || user.disabledAt) return null;
  if (user.passwordChangedAt && issuedAt !== undefined && (issuedAt + 1) * 1000 <= user.passwordChangedAt.getTime()) {
    return null;
  }
  const now = Date.now();
  if (!user.lastActiveAt || now - user.lastActiveAt.getTime() > ACTIVE_REFRESH_MS) {
    await prisma.user.update({ where: { id: user.id }, data: { lastActiveAt: new Date(now) } }).catch(() => {});
  }
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

// For pages: send anyone not signed in to the sign-in screen.
export async function currentUser(): Promise<SessionUser> {
  const user = await readSession();
  if (!user) redirect("/login");
  return user;
}

export async function optionalUser(): Promise<SessionUser | null> {
  return readSession();
}

// For API routes.
export async function requireUser(roles?: Role[]): Promise<SessionUser> {
  const user = await readSession();
  if (!user) throw new AuthError(401, "Please sign in again.");
  if (roles && !roles.includes(user.role)) throw new AuthError(403, "You don't have permission to do that.");
  return user;
}

export const canReview = (role: Role) => role === "ADMIN" || role === "REVIEWER";
export const isAdmin = (role: Role) => role === "ADMIN";

// Emails in ADMIN_EMAILS can create an account without an invite, and are always admins.
export function bootstrapAdmins(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}
