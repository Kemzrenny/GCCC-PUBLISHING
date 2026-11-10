import Image from "next/image";
import Link from "next/link";

// Public pages (no sign-in): the home page Google shows on the consent screen, the privacy
// policy and the terms.
export default function PublicLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col px-5 py-8 sm:px-8">
      <header className="mb-10 flex flex-wrap items-center justify-between gap-4">
        <Link href="/about" className="flex flex-col gap-1.5">
          <Image src="/brand/gccc-logo-ink.png" alt="Glory Centre Community Church" width={150} height={32} className="h-8 w-auto dark:hidden" priority />
          <Image src="/brand/gccc-logo.png" alt="Glory Centre Community Church" width={150} height={32} className="hidden h-8 w-auto dark:block" priority />
          <span className="text-[11px] font-semibold tracking-[0.18em] text-red uppercase">Publishing</span>
        </Link>
        <Link href="/login" className="btn-primary">Team sign-in</Link>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="mt-12 flex flex-wrap gap-x-5 gap-y-2 border-t border-line pt-6 text-sm text-muted">
        <span>© {new Date().getFullYear()} Glory Realms Ministries</span>
        <Link className="hover:underline" href="/about">About</Link>
        <Link className="hover:underline" href="/privacy">Privacy policy</Link>
        <Link className="hover:underline" href="/terms">Terms of service</Link>
      </footer>
    </div>
  );
}
