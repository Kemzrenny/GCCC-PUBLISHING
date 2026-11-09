"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { TABS } from "@/lib/status";

// The status tabs and the speaker/year filters. Everything lives in the address, so a
// filtered view can be bookmarked or shared.
export default function LibraryFilters({ speakers, years }: { speakers: string[]; years: number[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const tab = params.get("tab") ?? "all";

  const hrefWith = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value && !(key === "tab" && value === "all")) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    const qs = next.toString();
    return qs ? `/library?${qs}` : "/library";
  };

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <div role="tablist" aria-label="Transcript status" className="flex flex-wrap gap-0.5 rounded-[10px] bg-seg p-1">
        {TABS.map((t) => (
          <Link
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            href={hrefWith("tab", t.key)}
            className={`flex h-9 items-center rounded-lg px-3.5 text-[13px] font-medium ${tab === t.key ? "bg-seg-on text-ink shadow-sm" : "text-muted hover:text-ink"}`}
          >
            {t.label}
          </Link>
        ))}
      </div>
      <label className="sr-only" htmlFor="speaker">Speaker</label>
      <select
        id="speaker"
        className="field h-11 w-auto min-w-40 text-[13px] font-medium"
        value={params.get("speaker") ?? ""}
        onChange={(e) => router.push(hrefWith("speaker", e.target.value))}
      >
        <option value="">All speakers</option>
        {speakers.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
      <label className="sr-only" htmlFor="year">Year</label>
      <select
        id="year"
        className="field h-11 w-auto text-[13px] font-medium"
        value={params.get("year") ?? ""}
        onChange={(e) => router.push(hrefWith("year", e.target.value))}
      >
        <option value="">All years</option>
        {years.map((y) => (
          <option key={y} value={y}>{y}</option>
        ))}
      </select>
    </div>
  );
}
