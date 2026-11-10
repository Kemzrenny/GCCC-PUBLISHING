"use client";

import { usePathname } from "next/navigation";

const NAMES: Record<string, string> = {
  library: "Message library",
  messages: "Message",
  review: "Review queue",
  "check-dates": "Check dates",
  settings: "Settings",
  speakers: "Speakers",
};

export default function Breadcrumb() {
  const [, section = "library", sub] = usePathname().split("/");
  const page = section === "settings" && sub && NAMES[sub] ? NAMES[sub] : null;
  return (
    <nav aria-label="Breadcrumb" className="text-lg text-muted sm:text-xl">
      Publishing <span aria-hidden>/</span> {page ? (
        <>
          {NAMES.settings} <span aria-hidden>/</span> <span className="text-ink">{page}</span>
        </>
      ) : (
        <span className="text-ink">{NAMES[section] ?? "Library"}</span>
      )}
    </nav>
  );
}
