import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { PageHeading, Empty } from "@/components/ui";
import Pagination from "@/components/Pagination";
import GloryTabs from "@/components/glory/GloryTabs";
import { manualList, type ManualFilter } from "@/lib/glory-data";
import { STAGE_LABEL, manualCode, type Stage } from "@/lib/glory";
import { formatDate } from "@/lib/dates";

export const metadata = { title: "All manuals" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const SHOWS = ["all", "message", "docs"] as const;

export default async function ManualsPage({ searchParams }: PageProps<"/glory-home/manuals">) {
  await currentUser();
  const sp = await searchParams;
  const f: ManualFilter = {
    show: (SHOWS as readonly string[]).includes(one(sp.show)) ? (one(sp.show) as ManualFilter["show"]) : "all",
    year: /^\d{4}$/.test(one(sp.year)) ? one(sp.year) : "",
    writer: one(sp.writer).slice(0, 80),
    q: one(sp.q).slice(0, 100),
    page: Math.max(1, Number(one(sp.page)) || 1),
  };
  const list = await manualList(f);
  const kept = Object.fromEntries(Object.entries({ show: f.show === "all" ? "" : f.show, year: f.year, writer: f.writer, q: f.q }).filter(([, v]) => v));
  const href = (extra: Record<string, string | number>) => {
    const p = new URLSearchParams({ ...kept, ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, String(v)])) });
    for (const [k, v] of [...p.entries()]) if (!v || (k === "show" && v === "all") || (k === "page" && v === "1")) p.delete(k);
    const qs = p.toString();
    return `/glory-home/manuals${qs ? `?${qs}` : ""}`;
  };
  const tabs = [
    { key: "all", label: "All", n: list.counts.all },
    { key: "message", label: "Needs a message", n: list.counts.message },
    { key: "docs", label: "Not in the folder yet", n: list.counts.docs },
  ];

  return (
    <>
      <div className="flex flex-col gap-4">
        <PageHeading eyebrow="Glory Home" title="A manual every Saturday." />
        <GloryTabs active="manuals" counts={{ manuals: list.counts.all }} />
      </div>

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
            {list.counts.all === 0 ? "Plan a Saturday on the Calendar, or bring in past manuals from Settings › Glory Home." : "Try another filter."}
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] border-collapse">
              <thead>
                <tr className="text-left text-xs tracking-[0.04em] text-muted uppercase">
                  <th scope="col" className="border-b border-line pr-3 pb-3.5 font-medium">Manual</th>
                  <th scope="col" className="border-b border-line px-3 pb-3.5 font-medium">From message</th>
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
                          <span className="text-muted">Lined up</span>
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
          <span>{list.total.toLocaleString()} {list.total === 1 ? "manual" : "manuals"}</span>
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
