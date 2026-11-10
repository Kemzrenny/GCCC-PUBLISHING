import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { PageHeading, Empty } from "@/components/ui";
import Pagination from "@/components/Pagination";
import GloryTabs from "@/components/glory/GloryTabs";
import SheetUpload from "@/components/glory/SheetUpload";
import FolderImport from "@/components/glory/FolderImport";
import { manualList, type ManualFilter } from "@/lib/glory-data";
import { gloryRootUrl } from "@/lib/glory-drive";
import { driveConnected } from "@/lib/drive";
import { STAGE_LABEL, manualCode, monthLabel, type Stage } from "@/lib/glory";
import { formatDate } from "@/lib/dates";

export const metadata = { title: "All manuals" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const SHOWS = ["all", "message", "docs", "lined"] as const;

export default async function ManualsPage({ searchParams }: PageProps<"/glory-home/manuals">) {
  const user = await currentUser();
  const admin = user.role === "ADMIN";
  const sp = await searchParams;
  const f: ManualFilter = {
    show: (SHOWS as readonly string[]).includes(one(sp.show)) ? (one(sp.show) as ManualFilter["show"]) : "all",
    year: /^\d{4}$/.test(one(sp.year)) ? one(sp.year) : "",
    writer: one(sp.writer).slice(0, 80),
    q: one(sp.q).slice(0, 100),
    page: Math.max(1, Number(one(sp.page)) || 1),
  };
  const [list, connected, root, s] = await Promise.all([
    manualList(f),
    driveConnected(),
    gloryRootUrl(),
    getSettings(["gloryLastImport", "driveAccount"]),
  ]);
  const kept = Object.fromEntries(Object.entries({ show: f.show === "all" ? "" : f.show, year: f.year, writer: f.writer, q: f.q }).filter(([, v]) => v));
  const href = (extra: Record<string, string | number>) => {
    const p = new URLSearchParams({ ...kept, ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, String(v)])) });
    for (const [k, v] of [...p.entries()]) if (!v || (k === "show" && v === "all") || (k === "page" && v === "1")) p.delete(k);
    const qs = p.toString();
    return `/glory-home/manuals${qs ? `?${qs}` : ""}`;
  };
  let last: { at?: string; sheet?: { manuals: number; linedUp: number } } = {};
  try {
    last = JSON.parse(s.gloryLastImport || "{}");
  } catch {}
  const tabs = [
    { key: "all", label: "All", n: list.counts.all },
    { key: "message", label: "Needs a message", n: list.counts.message },
    { key: "docs", label: "Not in the folder yet", n: list.counts.docs },
    { key: "lined", label: "Lined up", n: list.counts.lined },
  ];

  return (
    <>
      <PageHeading eyebrow="Glory Home" title="Every manual, filed." lead="Each manual with the message it came from, its two documents and the Saturday it was taught.">
        <GloryTabs active="manuals" />
      </PageHeading>

      {admin && (
        <details open={list.counts.all === 0 || !root} className="rounded-2xl bg-banner px-6 py-5">
          <summary className="cursor-pointer font-display text-[22px] font-semibold">Bringing in the manuals you’ve already done</summary>
          {!connected ? (
            <p className="mt-3 text-sm">
              First connect Google Drive in <Link href="/settings#drive" className="font-medium text-accent hover:underline">Settings</Link>: the Glory Home folder is made in that account.
            </p>
          ) : (
            <ol className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-3">
              <li className="flex flex-col gap-2 rounded-xl bg-card p-4">
                <span className="text-xs font-semibold text-accent">1 · The Glory Home schedule</span>
                <span className="text-[15px] font-medium">Manual numbers, topics, writers and Saturdays</span>
                <span className="text-[13px] text-muted">Upload the schedule workbook. Its MASTER SHEET is read and each manual matched to its message. Running it again just updates them.</span>
                <SheetUpload />
                {last.sheet && <span className="text-xs text-muted">Last read {formatDate(last.at)}: {last.sheet.manuals} manuals, {last.sheet.linedUp} lined up.</span>}
              </li>
              <li className="flex flex-col gap-2 rounded-xl bg-card p-4">
                <span className="text-xs font-semibold text-accent">2 · The Glory Home folder</span>
                <span className="text-[15px] font-medium">Every Members Manual and Teacher’s Guide</span>
                <span className="text-[13px] text-muted">
                  Choose the folder from your computer. Each manual’s documents become Google Docs in {s.driveAccount || "the connected account"}’s{" "}
                  {root ? (
                    <a href={root} target="_blank" rel="noreferrer" className="font-medium text-accent hover:underline">Glory Home folder</a>
                  ) : (
                    "Glory Home folder"
                  )}
                  , one folder per month.
                </span>
                <FolderImport />
              </li>
              <li className="flex flex-col gap-2 rounded-xl bg-card p-4">
                <span className="text-xs font-semibold text-accent">3 · The message sheet</span>
                <span className="text-[15px] font-medium">A “Glory Home” column</span>
                <span className="text-[13px] text-muted">Done automatically: every message used for a manual shows its manual numbers here and in the Google Sheet mirror.</span>
              </li>
            </ol>
          )}
        </details>
      )}

      <section aria-label="Manuals" className="card flex flex-col gap-5 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <nav aria-label="Filter" className="flex flex-wrap gap-0.5 rounded-[10px] bg-seg p-1">
            {tabs.map((t) => (
              <Link
                key={t.key}
                href={href({ show: t.key, page: 1 })}
                aria-current={f.show === t.key ? "page" : undefined}
                className={`flex h-9 items-center rounded-lg px-3.5 text-[13px] font-medium ${f.show === t.key ? "bg-seg-on text-ink shadow-sm" : "text-muted hover:text-ink"}`}
              >
                {t.label}
                {t.key !== "all" && t.n > 0 && <span className="ml-1.5 text-muted">· {t.n}</span>}
              </Link>
            ))}
          </nav>
          <form action="/glory-home/manuals" className="flex flex-wrap gap-2.5">
            {f.show !== "all" && <input type="hidden" name="show" value={f.show} />}
            <label className="sr-only" htmlFor="m-q">Search manuals</label>
            <input id="m-q" name="q" type="search" defaultValue={f.q} placeholder="Topic, message or number" className="field h-11 w-56" />
            <label className="sr-only" htmlFor="m-writer">Writer</label>
            <select id="m-writer" name="writer" defaultValue={f.writer} className="field h-11 w-auto">
              <option value="">All writers</option>
              {list.writers.map((w) => (
                <option key={w}>{w}</option>
              ))}
            </select>
            <label className="sr-only" htmlFor="m-year">Year</label>
            <select id="m-year" name="year" defaultValue={f.year} className="field h-11 w-auto">
              <option value="">All years</option>
              {list.years.map((y) => (
                <option key={y}>{y}</option>
              ))}
            </select>
            <button type="submit" className="btn-quiet h-11">Filter</button>
          </form>
        </div>

        {list.rows.length === 0 ? (
          <Empty title={list.counts.all === 0 ? "No manuals yet" : "Nothing matches"}>
            {list.counts.all === 0 ? "Bring in the schedule and the folder above, or plan a Saturday from the Month view." : "Try another filter."}
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] border-collapse">
              <thead>
                <tr className="text-left text-xs tracking-[0.04em] text-muted uppercase">
                  <th scope="col" className="border-b border-line pr-3 pb-3.5 font-medium">{f.show === "lined" ? "Message" : "Manual"}</th>
                  <th scope="col" className="border-b border-line px-3 pb-3.5 font-medium">{f.show === "lined" ? "For" : "From message"}</th>
                  <th scope="col" className="border-b border-line px-3 pb-3.5 font-medium">Writers</th>
                  <th scope="col" className="border-b border-line px-3 pb-3.5 font-medium">Documents</th>
                  <th scope="col" className="border-b border-line pb-3.5 pl-3 text-right font-medium">Saturday</th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((m) => {
                  const writers = [m.membersWriter, m.guideWriter !== m.membersWriter ? m.guideWriter : null].filter(Boolean).join(" & ");
                  const lined = !m.saturday && !m.number;
                  return (
                    <tr key={m.id} className="hover:bg-field/40">
                      <td className="border-b border-line py-3.5 pr-3">
                        {lined ? (
                          <Link href={`/glory-home/manuals/${m.id}`} className="text-[15px] font-medium hover:underline">{m.message?.title ?? m.sourceTitle ?? "A sermon"}</Link>
                        ) : (
                          <>
                            <span className="text-xs font-semibold tracking-[0.04em] text-accent">{manualCode(m.number) ?? "No number"}</span>
                            <Link href={`/glory-home/manuals/${m.id}`} className="mt-0.5 block text-[15px] font-medium hover:underline">{m.title || "Topic not set"}</Link>
                          </>
                        )}
                      </td>
                      <td className="border-b border-line px-3 py-3.5 text-sm">
                        {lined ? (
                          <span className="text-muted">{m.plannedMonth ? monthLabel(m.plannedMonth) : "No month"}</span>
                        ) : m.message ? (
                          <>
                            <Link href={`/messages/${m.message.id}`} className="font-medium hover:underline">{m.message.title}</Link>
                            {m.parts && m.parts > 1 && <div className="mt-0.5 text-xs text-muted">Part {m.part} of {m.parts}</div>}
                          </>
                        ) : (
                          <>
                            <Link href={`/glory-home/manuals/${m.id}#message`} className="inline-flex h-9 items-center rounded-lg border border-dashed border-alert px-3 text-[13px] font-medium text-alert">
                              Match a message
                            </Link>
                            {m.sourceTitle && <div className="mt-1 text-xs text-muted">Schedule says “{m.sourceTitle}”</div>}
                          </>
                        )}
                      </td>
                      <td className="border-b border-line px-3 py-3.5 text-sm text-muted">{writers || "—"}</td>
                      <td className="border-b border-line px-3 py-3.5 text-[13px]">
                        {lined ? (
                          <span className="text-muted">—</span>
                        ) : (
                          <span className="flex flex-wrap gap-1.5">
                            <DocChip url={m.membersUrl} own={!!m.membersDocId} label="Members" />
                            <DocChip url={m.guideUrl} own={!!m.guideDocId} label="Teacher’s" />
                          </span>
                        )}
                      </td>
                      <td className="border-b border-line py-3.5 pl-3 text-right text-sm whitespace-nowrap">
                        {m.saturday ? formatDate(m.saturday) : <span className="text-muted">—</span>}
                        {!lined && <div className={`mt-0.5 text-xs ${m.stage === "TAUGHT" ? "text-[var(--chip-green)]" : "text-muted"}`}>{STAGE_LABEL[m.stage as Stage]}</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
          <span>{list.total.toLocaleString()} {f.show === "lined" ? "lined up" : list.total === 1 ? "manual" : "manuals"}</span>
          <Pagination page={f.page} pages={list.pages} href={(n) => href({ page: n })} action="/glory-home/manuals" params={kept} />
        </div>
      </section>
    </>
  );
}

// A document's link: our own copy in the Glory Home folder, an older copy elsewhere, or none.
function DocChip({ url, own, label }: { url: string | null; own: boolean; label: string }) {
  if (!url) return <span className="rounded-lg bg-field px-2.5 py-1 font-medium text-muted line-through">{label}</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      title={own ? "In the Glory Home folder" : "An older copy, not in the Glory Home folder yet"}
      className={`rounded-lg px-2.5 py-1 font-medium ${own ? "bg-[var(--chip-blue-bg)] text-[var(--chip-blue)]" : "border border-dashed border-line text-muted"}`}
    >
      {label}
    </a>
  );
}
