import Link from "next/link";

export default function GloryTabs({ active }: { active: "month" | "manuals" }) {
  const tab = (on: boolean) => `flex h-10 items-center rounded-lg px-4 text-[13px] font-medium ${on ? "bg-seg-on text-ink shadow-sm" : "text-muted hover:text-ink"}`;
  return (
    <nav aria-label="Glory Home views" className="flex gap-0.5 rounded-[10px] bg-seg p-1">
      <Link href="/glory-home" aria-current={active === "month" ? "page" : undefined} className={tab(active === "month")}>Month</Link>
      <Link href="/glory-home/manuals" aria-current={active === "manuals" ? "page" : undefined} className={tab(active === "manuals")}>All manuals</Link>
    </nav>
  );
}
