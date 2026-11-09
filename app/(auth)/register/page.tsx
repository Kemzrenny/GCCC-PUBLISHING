import AuthForm from "@/components/AuthForm";

export const metadata = { title: "Create your account" };

export default function RegisterPage() {
  return (
    <>
      <h1 className="mb-1 font-display text-2xl font-semibold">Create your account</h1>
      <p className="mb-6 text-sm text-muted">Use the email a Publishing admin invited.</p>
      <AuthForm mode="register" />
    </>
  );
}
