import { looksLikeFuture } from "./dates";

type M = { title: string; podbeanTitle: string | null; date: Date | null };

// A message created from a Podbean title that couldn't be read keeps that raw title until
// someone names it; anything else already has a real title.
export const titleKnown = (m: M) => !(m.podbeanTitle && m.title === m.podbeanTitle);

export function missingDetails(m: M): string[] {
  const out: string[] = [];
  if (!titleKnown(m)) out.push("a title");
  if (!m.date) out.push("the date");
  else if (looksLikeFuture(m.date)) out.push("a real date (this one is in the future)");
  return out;
}
