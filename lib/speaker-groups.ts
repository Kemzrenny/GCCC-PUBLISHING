// Spots speaker names that are probably the same person, so an admin can merge them with
// one click. Only suggestions: nothing changes until someone confirms.
//
// Two names are grouped when, ignoring the title (Pastor, Prophet…):
// - the surnames match, allowing one typing slip ("Zakariy" / "Zakariya"), and
// - the first names match, one is a short form of the other ("Kunle" / "Olakunle",
//   "Desola" / "Adesola", "Laolu" / "Olaolu" / "Olaoluwa"), or differ by one slip;
// or one has no surname ("Pastor Obi") and exactly one full name starts the same way.

export type SpeakerCount = { name: string; count: number };
export type SpeakerGroup = { suggested: string; names: SpeakerCount[] };

const TITLE_RE = /^(pastor|pst\.?|ps\.?|apostle|aps\.?|apst\.?|prophetess|prophet|reverend|rev\.?|bishop|evangelist|evang\.?|dr\.?|minister|min\.?)$/i;

function parts(name: string): { given: string[]; surname: string | null } {
  const words = name
    .toLowerCase()
    .replace(/[^\p{L}\s.-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  while (words.length && TITLE_RE.test(words[0])) words.shift();
  if (words.length === 0) return { given: [], surname: null };
  if (words.length === 1) return { given: words, surname: null };
  return { given: words.slice(0, -1), surname: words[words.length - 1] };
}

function distance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

function sameSurname(a: string, b: string) {
  return a === b || (Math.min(a.length, b.length) >= 5 && distance(a, b) <= 1);
}

// "kunle" is a short form of "olakunle"; "olaolu" of "olaoluwa".
function sameGiven(a: string, b: string) {
  if (a === b) return true;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  if (s.length >= 4 && (l.endsWith(s) || l.startsWith(s))) return true;
  return Math.min(a.length, b.length) >= 5 && distance(a, b) <= 1;
}

function firstGiven(p: ReturnType<typeof parts>) {
  return p.given[0] ?? "";
}

export function groupSpeakers(speakers: SpeakerCount[]): SpeakerGroup[] {
  const items = speakers.map((s) => ({ ...s, p: parts(s.name) }));
  const parent = items.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const join = (a: number, b: number) => {
    parent[find(a)] = find(b);
  };

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i].p;
      const b = items[j].p;
      if (!a.given.length || !b.given.length) continue;
      if (a.surname && b.surname) {
        if (sameSurname(a.surname, b.surname) && sameGiven(firstGiven(a), firstGiven(b))) join(i, j);
      } else if (!a.surname && !b.surname) {
        if (firstGiven(a) === firstGiven(b)) join(i, j);
      }
    }
  }
  // "Pastor Obi" joins "Pastor Obi Esiobu" only when there's exactly one full name it fits.
  for (let i = 0; i < items.length; i++) {
    if (items[i].p.surname || !items[i].p.given.length) continue;
    const given = firstGiven(items[i].p);
    const fits = items.map((it, j) => ({ it, j })).filter(({ it }) => it.p.surname && it.p.given[0] === given);
    const families = new Set(fits.map(({ j }) => find(j)));
    if (families.size === 1) join(i, fits[0].j);
  }

  const groups = new Map<number, SpeakerCount[]>();
  items.forEach((it, i) => {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), { name: it.name, count: it.count }]);
  });
  return [...groups.values()]
    .filter((g) => g.length > 1)
    .map((names) => {
      names.sort((a, b) => b.count - a.count || b.name.length - a.name.length);
      // The most used spelling, preferring a full name (with a surname) over a short one.
      const full = names.filter((n) => parts(n.name).surname);
      const suggested = (full.length ? full : names).reduce((best, n) => (n.count > best.count || (n.count === best.count && n.name.length > best.name.length) ? n : best)).name;
      return { suggested, names };
    })
    .sort((a, b) => b.names.reduce((t, n) => t + n.count, 0) - a.names.reduce((t, n) => t + n.count, 0));
}
