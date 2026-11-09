import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowUpRight } from "lucide-react";
import { currentUser } from "@/lib/auth";
import { libraryPage, libraryStats, readQuery, PAGE_SIZE } from "@/lib/library";
import { formatDate, monthOverdue } from "@/lib/dates";
import { PageHeading, StatCard, StatusChip, Empty } from "@/components/ui";
import LibraryFilters from "@/components/LibraryFilters";

export const metadata = { title: "Message library" };

export default async function LibraryPage({ searchParams }: PageProps<"/library">) {
  await currentUser();
  const query = readQuery(await searchParams);
  const [stats, page] = await Promise.all([libraryStats(), libraryPage(query)]);
  const pct = stats.total ? ((stats.approved / stats.total) * 100).toFixed(1) : "0";
  const pageHref = (n: number) => {
    const p = new URLSearchParams(Object.entries(query).filter(([k, v]) => v && k !== "page" && !(k === "tab" && v === "all")));
    if (n > 1) p.set("page", String(n));
    const qs = p.toString();
    return qs ? `/library?${qs}` : "/library";
  };
  const from = (page.page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page.page * PAGE_SIZE, page.total);

  return (
    <>
      <PageHeading eyebrow="Message library" title="Every message, preserved." lead="Papi’s messages from Podbean, each with its transcript and everything made from it." />

      {stats.needsDetails > 0 && (
        <section aria-label="Needs attention" className="flex flex-wrap items-center gap-4 rounded-2xl bg-banner px-6 py-5">
          <div aria-hidden className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-brand">
            <Image src="/brand/gccc-mark.png" alt="" width={30} height={18} />
          </div>
          <div className="flex min-w-64 flex-1 flex-col gap-1">
            <span className="font-display text-xl font-semibold">
              {stats.needsDetails} message{stats.needsDetails === 1 ? " needs" : "s need"} details confirmed
            </span>
            <span className="text-[15px] text-muted">A title or date is missing or looks wrong. Confirm them to keep the archive clean.</span>
          </div>
          <Link href="/needs-details" className="btn-quiet h-12 px-5">Review details</Link>
        </section>
      )}

      <section aria-label="Archive totals" className="grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-4">
        <StatCard label="Messages" value={stats.total.toLocaleString()} note="Full Podbean archive" tone="accent" />
        <StatCard label="Transcribed" value={stats.approved.toLocaleString()} note={`${pct}% of the archive`} tone="accent" />
        <StatCard label="Backlog" value={stats.backlog.toLocaleString()} note={stats.inProgress ? `${stats.inProgress} in progress now` : "Cleared in batches"} />
        <StatCard
          label="Linked to manuals"
          value={stats.linkedManuals.toLocaleString()}
          note={stats.manualsWritten ? `Of ${stats.manualsWritten} Glory Home manuals` : "Glory Home manuals"}
          tone="alert"
        />
      </section>

      <section aria-label="Messages" className="card flex flex-col gap-5 p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="font-display text-2xl font-semibold">{query.q ? `Results for “${query.q}”` : "Messages"}</h2>
          <Suspense>
            <LibraryFilters speakers={stats.speakers} years={stats.years} />
          </Suspense>
        </div>

        {page.rows.length === 0 ? (
          stats.total === 0 ? (
            <Empty title="The library is empty">
              An admin can import the old Publishing sheet from Settings, or use Check Podbean to bring in recent messages.
            </Empty>
          ) : (
            <Empty title="No messages match">Try another status, speaker or year, or clear the search.</Empty>
          )
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] border-collapse">
              <thead>
                <tr className="text-left text-xs tracking-[0.04em] text-muted uppercase">
                  <th scope="col" className="border-b border-line pr-3 pb-3.5 font-medium">Message</th>
                  <th scope="col" className="border-b border-line px-3 pb-3.5 font-medium">Speaker</th>
                  <th scope="col" className="border-b border-line px-3 pb-3.5 font-medium">Transcript</th>
                  <th scope="col" className="border-b border-line px-3 pb-3.5 font-medium">Assigned</th>
                  <th scope="col" className="border-b border-line px-3 pb-3.5 font-medium">Manuals</th>
                  <th scope="col" className="border-b border-line pb-3.5 pl-3 text-right font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {page.rows.map((m) => {
                  const who = m.assignee?.name ?? m.assigneeName;
                  return (
                    <tr key={m.id} className="hover:bg-field/40">
                      <td className="border-b border-line py-4 pr-3">
                        <Link href={`/messages/${m.id}`} className="text-[15px] font-medium hover:underline">{m.title}</Link>
                        <div className={`mt-1 text-[13px] ${m.needsDetails ? "text-alert" : "text-muted"}`}>
                          {m.needsDetails ? "Needs its details confirmed" : [m.series, m.location?.split(",")[0]].filter(Boolean).join(" · ")}
                        </div>
                      </td>
                      <td className="border-b border-line px-3 py-4 text-sm whitespace-nowrap text-muted">{m.speaker ?? "—"}</td>
                      <td className="border-b border-line px-3 py-4"><StatusChip status={m.status} needsDetails={m.needsDetails} /></td>
                      <td className="border-b border-line px-3 py-4 text-sm">
                        {who ?? <span className="text-muted">Unassigned</span>}
                        {m.dueLabel && m.status !== "APPROVED" && (
                          <div className={`mt-0.5 text-xs ${monthOverdue(m.dueLabel) ? "text-alert" : "text-muted"}`}>
                            Due {m.dueLabel}
                            {monthOverdue(m.dueLabel) && " · overdue"}
                          </div>
                        )}
                      </td>
                      <td className="border-b border-line px-3 py-4 text-sm text-muted">{m._count.manuals || "—"}</td>
                      <td className="border-b border-line py-4 pl-3 text-right text-sm whitespace-nowrap text-muted">{formatDate(m.date) || "No date"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {page.total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
            <span>
              Showing {from.toLocaleString()}–{to.toLocaleString()} of {page.total.toLocaleString()} messages
            </span>
            <div className="flex gap-2">
              {page.page > 1 && <Link className="btn-quiet" href={pageHref(page.page - 1)}>Previous</Link>}
              {page.page < page.pages && (
                <Link className="btn-quiet" href={pageHref(page.page + 1)}>
                  Next <ArrowUpRight aria-hidden size={14} className="rotate-45" />
                </Link>
              )}
            </div>
          </div>
        )}
      </section>
    </>
  );
}
