import { cookies } from "next/headers";
import Link from "next/link";
import { Search, RefreshCw } from "lucide-react";
import { currentUser, canReview } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { after } from "next/server";
import { nudgeStalledQueue } from "@/lib/jobs";
import Sidebar from "@/components/Sidebar";
import ActionButton from "@/components/ActionButton";
import Breadcrumb from "@/components/Breadcrumb";

// "Check Podbean" (in the top bar on every page) reads old episode pages, which takes a while.
export const maxDuration = 300;
import { checkPodbeanNow } from "@/app/actions/messages";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await currentUser();
  const theme = (await cookies()).get("theme")?.value === "dark" ? "dark" : "light";
  // Restart the transcription queue if it has stalled (runs after the page is sent).
  after(() => nudgeStalledQueue().catch(() => {}));
  const [review, needs, approved, total] = await Promise.all([
    prisma.message.count({ where: { status: { in: ["AI_DRAFT", "IN_REVIEW"] } } }),
    prisma.message.count({ where: { needsDetails: true } }),
    prisma.message.count({ where: { status: "APPROVED" } }),
    prisma.message.count(),
  ]);

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <Sidebar user={user} counts={{ review, needs, approved, total }} theme={theme} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line px-5 py-5 sm:px-10">
          <Breadcrumb />
          <div className="flex flex-wrap items-center gap-3">
            <form action="/library" className="relative w-[340px] max-w-full">
              <label htmlFor="global-search" className="sr-only">Search messages</label>
              <Search aria-hidden size={18} className="absolute top-3.5 left-3.5 text-muted" />
              <input id="global-search" name="q" type="search" placeholder="Search titles, themes, scriptures…" className="field h-11 pl-10" />
            </form>
            {canReview(user.role) && (
              <ActionButton action={checkPodbeanNow} className="btn-primary" pendingLabel="Checking…">
                <RefreshCw aria-hidden size={16} /> Check Podbean
              </ActionButton>
            )}
          </div>
        </header>
        <main className="flex flex-col gap-6 px-5 pt-8 pb-12 sm:px-10">{children}</main>
        <footer className="mt-auto px-5 pb-6 text-xs text-muted sm:px-10">
          Glory Realms Ministries Publishing · <Link className="hover:underline" href="/library">Message library</Link>
        </footer>
      </div>
    </div>
  );
}
