"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AudioLines, Plug, CalendarDays, Mic, Users, Upload, MapPin } from "lucide-react";

export type NavFlags = { connections?: "alert" | null; speakers?: number; team?: number };

const ITEMS = [
  { href: "/settings", label: "Transcription", hint: "Queue, batches and service", icon: AudioLines },
  { href: "/settings/connections", label: "Connections", hint: "Podbean, Drive and the Sheet", icon: Plug },
  { href: "/settings/glory-home", label: "Glory Home", hint: "Templates and writing teams", icon: CalendarDays },
  { href: "/settings/speakers", label: "Speakers", hint: "Merge and rename", icon: Mic },
  { href: "/settings/branches", label: "Branches", hint: "Where messages were preached", icon: MapPin },
  { href: "/settings/team", label: "Team", hint: "Who has access", icon: Users },
  { href: "/settings/import", label: "Import", hint: "The old Publishing sheet", icon: Upload },
] as const;

// Settings' own menu: a column beside the page on wide screens, a row of tabs on phones.
export default function SettingsNav({ flags }: { flags: NavFlags }) {
  const path = usePathname();
  const badge = (href: string) => {
    if (href === "/settings/connections" && flags.connections) return <span className="size-2 rounded-full bg-alert" aria-label="needs attention" />;
    const n = href === "/settings/speakers" ? flags.speakers : href === "/settings/team" ? flags.team : 0;
    return n ? <span className="rounded-full bg-banner px-2 py-0.5 text-xs font-medium text-ink">{n}</span> : null;
  };
  return (
    <nav aria-label="Settings" className="-mx-5 overflow-x-auto px-5 sm:mx-0 sm:px-0 lg:sticky lg:top-6 lg:self-start">
      <ul className="flex gap-1.5 lg:flex-col lg:gap-1">
        {ITEMS.map(({ href, label, hint, icon: Icon }) => {
          const active = href === "/settings" ? path === href : path === href || path.startsWith(`${href}/`);
          return (
            <li key={href} className="shrink-0">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-sm lg:py-3 ${
                  active ? "bg-card font-medium text-ink shadow-[0_0_0_1px_var(--line)]" : "text-muted hover:bg-card/60 hover:text-ink"
                }`}
              >
                <Icon aria-hidden size={18} strokeWidth={1.7} className="shrink-0" />
                <span className="flex flex-1 flex-col whitespace-nowrap">
                  {label}
                  <span className="hidden text-xs font-normal text-muted lg:block">{hint}</span>
                </span>
                {badge(href)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
