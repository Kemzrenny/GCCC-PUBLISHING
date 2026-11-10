"use client";

import { usePathname } from "next/navigation";

const NAMES: Record<string, string> = {
  library: "Message library",
  messages: "Message",
  review: "Review queue",
  "needs-details": "Needs details",
  settings: "Settings",
  speakers: "Speakers",
};

export default function Breadcrumb() {
  const section = usePathname().split("/")[1] ?? "library";
  return (
    <nav aria-label="Breadcrumb" className="text-lg text-muted sm:text-xl">
      Publishing <span aria-hidden>/</span> <span className="text-ink">{NAMES[section] ?? "Library"}</span>
    </nav>
  );
}
