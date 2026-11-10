import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

// Page links (first, last and the pages around the current one) plus a box to jump straight
// to any page. Works without JavaScript: the jump box is a plain GET form.
type Props = {
  page: number;
  pages: number;
  href: (n: number) => string;
  action: string;
  // The other filters, kept when jumping.
  params: Record<string, string>;
};

export function pageList(page: number, pages: number): (number | "gap")[] {
  const keep = new Set([1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages));
  // Show a full run near either end instead of a gap of one page.
  if (page <= 4) for (let n = 1; n <= Math.min(5, pages); n++) keep.add(n);
  if (page >= pages - 3) for (let n = Math.max(1, pages - 4); n <= pages; n++) keep.add(n);
  const sorted = [...keep].sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  sorted.forEach((n, i) => {
    if (i && n - sorted[i - 1] > 1) out.push("gap");
    out.push(n);
  });
  return out;
}

export default function Pagination({ page, pages, href, action, params }: Props) {
  if (pages <= 1) return null;
  const box = "flex h-10 min-w-10 items-center justify-center rounded-lg px-3 text-sm font-medium";
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
      <nav aria-label="Pages" className="flex flex-wrap items-center gap-1">
        {page > 1 ? (
          <Link href={href(page - 1)} className={`${box} text-ink hover:bg-nav-on`} aria-label="Previous page">
            <ChevronLeft aria-hidden size={18} />
          </Link>
        ) : (
          <span className={`${box} text-muted opacity-40`} aria-hidden>
            <ChevronLeft size={18} />
          </span>
        )}
        {pageList(page, pages).map((n, i) =>
          n === "gap" ? (
            <span key={`gap-${i}`} className="px-1 text-muted" aria-hidden>
              …
            </span>
          ) : n === page ? (
            <span key={n} aria-current="page" className={`${box} bg-button text-white`}>
              {n.toLocaleString()}
            </span>
          ) : (
            <Link key={n} href={href(n)} className={`${box} text-ink hover:bg-nav-on`} aria-label={`Page ${n}`}>
              {n.toLocaleString()}
            </Link>
          ),
        )}
        {page < pages ? (
          <Link href={href(page + 1)} className={`${box} text-ink hover:bg-nav-on`} aria-label="Next page">
            <ChevronRight aria-hidden size={18} />
          </Link>
        ) : (
          <span className={`${box} text-muted opacity-40`} aria-hidden>
            <ChevronRight size={18} />
          </span>
        )}
      </nav>
      <form action={action} method="get" className="flex items-center gap-2 text-sm text-muted">
        {Object.entries(params).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <label htmlFor="jump-page">Go to page</label>
        <input id="jump-page" name="page" type="number" min={1} max={pages} defaultValue={page} required className="field h-10 w-20 px-2 text-center" />
        <span>of {pages.toLocaleString()}</span>
        <button type="submit" className="btn-quiet h-10">Go</button>
      </form>
    </div>
  );
}
