"use client";

import { useActionState } from "react";
import Link from "next/link";
import { login, register, type FormState } from "@/app/actions/auth";

export default function AuthForm({ mode }: { mode: "login" | "register" }) {
  const [state, action, pending] = useActionState<FormState, FormData>(mode === "login" ? login : register, null);
  return (
    <form action={action} className="flex flex-col gap-4">
      {mode === "register" && (
        <div>
          <label className="label" htmlFor="name">Your name</label>
          <input className="field" id="name" name="name" autoComplete="name" required />
        </div>
      )}
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input className="field" id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div>
        <label className="label" htmlFor="password">Password</label>
        <input
          className="field"
          id="password"
          name="password"
          type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          minLength={mode === "register" ? 8 : undefined}
          required
        />
      </div>
      {state?.error && (
        <p role="alert" className="rounded-[10px] bg-[var(--chip-red-bg)] px-3 py-2.5 text-sm text-[var(--chip-red)]">
          {state.error}
        </p>
      )}
      <button className="btn-primary mt-1 w-full" disabled={pending}>
        {pending ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
      </button>
      <p className="text-center text-sm text-muted">
        {mode === "login" ? (
          <>Been invited? <Link className="link" href="/register">Create your account</Link></>
        ) : (
          <>Already have an account? <Link className="link" href="/login">Sign in</Link></>
        )}
      </p>
    </form>
  );
}
