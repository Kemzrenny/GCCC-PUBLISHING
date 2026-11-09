import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="font-display text-3xl font-semibold">Not found</p>
      <p className="text-muted">That page or message isn’t in the portal.</p>
      <Link href="/library" className="btn-primary mt-2">Go to the library</Link>
    </main>
  );
}
