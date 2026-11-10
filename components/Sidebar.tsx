"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import {
  LayoutGrid,
  ListChecks,
  CalendarCheck,
  CalendarDays,
  BookOpen,
  FileText,
  Users,
  Settings,
  ChevronsUpDown,
  LogOut,
  Moon,
  Sun,
  Menu,
  X,
} from "lucide-react";
import type { Role } from "@prisma/client";
import { logout } from "@/app/actions/auth";
import { setTheme } from "@/app/actions/admin";
import { runNextBatch } from "@/app/actions/messages";
import ActionButton from "./ActionButton";

type Props = {
  user: { name: string; role: Role };
  counts: { review: number; needs: number; approved: number; total: number };
  theme: "light" | "dark";
};

const ROLE_LABEL: Record<Role, string> = { ADMIN: "Admin", REVIEWER: "Reviewer", WRITER: "Writer", VIEWER: "Viewer" };

function NavLink({ href, icon: Icon, children, count }: { href: string; icon: typeof LayoutGrid; children: React.ReactNode; count?: number }) {
  const path = usePathname();
  const active = path === href || path.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-3 rounded-[10px] px-3 py-3 text-sm ${active ? "bg-nav-on font-medium text-ink" : "text-nav hover:bg-nav-on/60"}`}
    >
      <Icon aria-hidden size={20} strokeWidth={1.7} />
      <span className="flex-1">{children}</span>
      {!!count && <span className="rounded-full bg-card px-2 py-0.5 text-xs font-medium text-muted">{count.toLocaleString()}</span>}
    </Link>
  );
}

function Soon({ icon: Icon, children }: { icon: typeof LayoutGrid; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-3 px-3 py-3 text-sm text-muted" title="Coming in a later phase">
      <Icon aria-hidden size={20} strokeWidth={1.7} />
      <span className="flex-1">{children}</span>
      <span className="text-[11px] tracking-wide uppercase">Soon</span>
    </span>
  );
}

export default function Sidebar({ user, counts, theme }: Props) {
  const [menu, setMenu] = useState(false);
  // On phones the sidebar folds into a menu button so the library comes first.
  const [open, setOpen] = useState(false);
  const fold = open ? "flex" : "hidden lg:flex";
  const [, start] = useTransition();
  const reviewer = user.role === "ADMIN" || user.role === "REVIEWER";
  const pct = counts.total ? (counts.approved / counts.total) * 100 : 0;

  return (
    <nav
      aria-label="Main"
      className="flex w-full flex-col gap-6 border-b border-line bg-side px-4 py-5 lg:sticky lg:border-b-0 lg:py-6 lg:top-0 lg:h-dvh lg:w-[264px] lg:shrink-0 lg:overflow-y-auto lg:border-r"
    >
      <div className="flex items-start justify-between gap-3">
      <Link href="/library" className="flex flex-col gap-1.5 px-1">
        <Image src="/brand/gccc-logo-ink.png" alt="Glory Centre Community Church" width={140} height={30} className="h-[30px] w-auto self-start dark:hidden" priority />
        <Image src="/brand/gccc-logo.png" alt="Glory Centre Community Church" width={140} height={30} className="hidden h-[30px] w-auto self-start dark:block" priority />
        <span className="text-[11px] font-semibold tracking-[0.18em] text-red uppercase">Publishing</span>
      </Link>
        <button
          type="button"
          className="btn-quiet h-11 w-11 px-0 lg:hidden"
          aria-expanded={open}
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <X aria-hidden size={20} /> : <Menu aria-hidden size={20} />}
        </button>
      </div>

      <div className={`${fold} flex-col gap-0.5`}>
        <span className="px-1 pb-2 text-[11px] tracking-[0.06em] text-muted uppercase">Library</span>
        <NavLink href="/library" icon={LayoutGrid}>Message library</NavLink>
        <NavLink href="/review" icon={ListChecks} count={counts.review}>Review queue</NavLink>
        {reviewer && <NavLink href="/check-dates" icon={CalendarCheck} count={counts.needs}>Check dates</NavLink>}
      </div>

      <div className={`${fold} flex-col gap-0.5`}>
        <span className="px-1 pb-2 text-[11px] tracking-[0.06em] text-muted uppercase">Publishing</span>
        <Soon icon={CalendarDays}>Glory Home calendar</Soon>
        <Soon icon={BookOpen}>Books &amp; booklets</Soon>
        <Soon icon={FileText}>Tracts</Soon>
        <Soon icon={Users}>Teams &amp; rotation</Soon>
        {user.role === "ADMIN" && <NavLink href="/settings" icon={Settings}>Settings</NavLink>}
      </div>

      <div className={`${fold} mt-auto flex-col gap-3`}>
        <div className="card flex flex-col gap-2.5 rounded-xl p-4">
          <span className="text-[15px] font-semibold">Transcription backlog</span>
          <span className="text-[13px] text-muted">
            {counts.approved.toLocaleString()} / {counts.total.toLocaleString()} transcribed
          </span>
          <div role="img" aria-label={`${pct.toFixed(1)}% transcribed`} className="h-1.5 rounded-full bg-track">
            <div className="h-1.5 rounded-full bg-brand" style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
          {reviewer && (
            <ActionButton action={runNextBatch} className="btn-primary w-full" pendingLabel="Queueing…">
              Run next batch
            </ActionButton>
          )}
        </div>

        <div className="relative">
          <button
            type="button"
            aria-expanded={menu}
            onClick={() => setMenu((m) => !m)}
            className="flex h-14 w-full items-center gap-2.5 rounded-xl border border-line bg-card px-3 text-left"
          >
            <span aria-hidden className="flex size-8 items-center justify-center rounded-full bg-button font-semibold text-white">
              {user.name.trim()[0]?.toUpperCase()}
            </span>
            <span className="flex flex-1 flex-col">
              <span className="text-sm font-semibold">{user.name}</span>
              <span className="text-xs text-muted">{ROLE_LABEL[user.role]}</span>
            </span>
            <ChevronsUpDown aria-hidden size={16} />
          </button>
          {menu && (
            <div className="card absolute bottom-16 left-0 z-20 flex w-full flex-col p-1.5 shadow-lg">
              <button
                type="button"
                className="flex h-11 items-center gap-2.5 rounded-lg px-3 text-sm hover:bg-field"
                onClick={() => start(() => setTheme(theme === "dark" ? "light" : "dark"))}
              >
                {theme === "dark" ? <Sun aria-hidden size={16} /> : <Moon aria-hidden size={16} />}
                {theme === "dark" ? "Light mode" : "Dark mode"}
              </button>
              <form action={logout}>
                <button className="flex h-11 w-full items-center gap-2.5 rounded-lg px-3 text-sm hover:bg-field">
                  <LogOut aria-hidden size={16} /> Sign out
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
