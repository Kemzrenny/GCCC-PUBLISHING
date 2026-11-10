import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { optionalUser } from "@/lib/auth";

export default async function AuthLayout({ children }: LayoutProps<"/">) {
  if (await optionalUser()) redirect("/library");
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2 text-center">
          <Image src="/brand/gccc-logo-ink.png" alt="Glory Centre Community Church" width={160} height={34} className="h-8 w-auto dark:hidden" priority />
          <Image src="/brand/gccc-logo.png" alt="Glory Centre Community Church" width={160} height={34} className="hidden h-8 w-auto dark:block" priority />
          <span className="text-[11px] font-semibold tracking-[0.18em] text-red uppercase">Publishing</span>
        </div>
        <div className="card p-6 sm:p-8">{children}</div>
        <p className="mt-6 flex justify-center gap-5 text-xs text-muted">
          <Link className="hover:underline" href="/about">About</Link>
          <Link className="hover:underline" href="/privacy">Privacy policy</Link>
          <Link className="hover:underline" href="/terms">Terms of service</Link>
        </p>
      </div>
    </main>
  );
}
