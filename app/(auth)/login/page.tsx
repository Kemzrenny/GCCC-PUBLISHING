import AuthForm from "@/components/AuthForm";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <>
      <h1 className="mb-1 font-display text-2xl font-semibold">Welcome back</h1>
      <p className="mb-6 text-sm text-muted">Sign in to the Publishing portal.</p>
      <AuthForm mode="login" />
    </>
  );
}
