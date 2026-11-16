import Link from "next/link";
import { CalendarDays, Files } from "lucide-react";

// Glory Home's two views, as tabs under the page title.
export default function GloryTabs({ active, counts }: { active: "month" | "manuals"; counts?: { manuals?: number } }) {
  const tab = (on: boolean) =>
    `-mb-px flex h-11 items-center gap-2 border-b-2 px-1 text-[15px] font-medium ${on ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"}`;
  return (
    <nav aria-label="Glory Home" className="flex gap-6 border-b border-line">
      <Link href="/glory-home" aria-current={active === "month" ? "page" : undefined} className={tab(active === "month")}>
        <CalendarDays aria-hidden size={18} strokeWidth={1.8} /> Calendar
      </Link>
      <Link href="/glory-home/manuals" aria-current={active === "manuals" ? "page" : undefined} className={tab(active === "manuals")}>
        <Files aria-hidden size={18} strokeWidth={1.8} /> All manuals
        {counts?.manuals ? <span className="rounded-full bg-field px-2 py-0.5 text-xs text-muted">{counts.manuals.toLocaleString()}</span> : null}
      </Link>
    </nav>
  );
}
