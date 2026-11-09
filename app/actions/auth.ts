"use server";

import bcrypt from "bcryptjs";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { setSessionCookie, clearSessionCookie, bootstrapAdmins } from "@/lib/auth";
import { rateLimit } from "@/lib/rateLimit";

export type FormState = { error?: string; ok?: string } | null;

async function ip() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
}

const loginSchema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1) });

export async function login(_: FormState, form: FormData): Promise<FormState> {
  if (!rateLimit(`login:${await ip()}`, 20, 15 * 60_000)) return { error: "Too many attempts. Wait a few minutes and try again." };
  const parsed = loginSchema.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: "Enter your email and password." };
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
    return { error: "Incorrect email or password." };
  }
  if (user.disabledAt) return { error: "This account has been turned off. Ask an admin." };
  await setSessionCookie(user.id);
  redirect("/library");
}

const registerSchema = z.object({
  name: z.string().trim().min(2, "Enter your name.").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email."),
  password: z.string().min(8, "Use at least 8 characters for your password.").max(200),
});

export async function register(_: FormState, form: FormData): Promise<FormState> {
  if (!rateLimit(`register:${await ip()}`, 10, 15 * 60_000)) return { error: "Too many attempts. Wait a few minutes and try again." };
  const parsed = registerSchema.safeParse({ name: form.get("name"), email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { name, email, password } = parsed.data;

  const isBootstrapAdmin = bootstrapAdmins().includes(email);
  const invite = await prisma.invite.findUnique({ where: { email } });
  if (!invite && !isBootstrapAdmin) {
    return { error: "This email hasn't been invited yet. Ask a Publishing admin to add you." };
  }
  if (await prisma.user.findUnique({ where: { email } })) return { error: "An account with this email already exists. Sign in instead." };

  const user = await prisma.user.create({
    data: { name, email, passwordHash: await bcrypt.hash(password, 10), role: isBootstrapAdmin ? "ADMIN" : invite!.role },
  });
  if (invite) await prisma.invite.delete({ where: { email } }).catch(() => {});
  await setSessionCookie(user.id);
  redirect("/library");
}

export async function logout() {
  await clearSessionCookie();
  redirect("/login");
}
