import { looksLikeFuture } from "./dates";
import { parseEpisodeTitle } from "./podbean-parse";

type M = { title: string; podbeanTitle: string | null; date: Date | null };

// A message created from a Podbean title that couldn't be read ("no title or date") keeps
// that raw title until someone names it. A raw title that is itself a clean title ("Grace
// for the Race") counts as known.
export const titleKnown = (m: M) => !(m.podbeanTitle && m.title === m.podbeanTitle) || parseEpisodeTitle(m.podbeanTitle).title !== null;

export function missingDetails(m: M): string[] {
  const out: string[] = [];
  if (!titleKnown(m)) out.push("a title");
  if (!m.date) out.push("the date");
  else if (looksLikeFuture(m.date)) out.push("a real date (this one is in the future)");
  return out;
}
