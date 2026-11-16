// Every message carries the branch it was preached at. Podbean rarely says, so branches are
// worked out from simple rules the admin sets: words in the episode's title or description
// ("UK", "Abuja"), or a speaker and dates ("Pastor Olakunle Zakariya, Jan–Jun 2024" while he
// was ministering at another branch). Anything else gets the main branch.

export type BranchRule = { name: string; words: string[]; speaker: string; from: string; to: string };
export type Branches = { main: string; branches: BranchRule[] };

export const DEFAULT_BRANCHES: Branches = { main: "Ojodu", branches: [{ name: "Ojodu", words: ["Ojodu"], speaker: "", from: "", to: "" }] };

export function parseBranches(json: string | null | undefined): Branches {
  try {
    const v = JSON.parse(json || "");
    if (v && typeof v.main === "string" && Array.isArray(v.branches)) {
      const branches = v.branches
        .filter((b: Partial<BranchRule>) => b && typeof b.name === "string" && b.name.trim())
        .map((b: Partial<BranchRule>) => ({
          name: String(b.name).trim(),
          words: Array.isArray(b.words) ? b.words.map(String).map((w: string) => w.trim()).filter(Boolean) : [],
          speaker: String(b.speaker ?? "").trim(),
          from: /^\d{4}-\d{2}-\d{2}$/.test(String(b.from)) ? String(b.from) : "",
          to: /^\d{4}-\d{2}-\d{2}$/.test(String(b.to)) ? String(b.to) : "",
        }));
      if (branches.length) return { main: branches.some((b: BranchRule) => b.name === v.main) ? v.main : branches[0].name, branches };
    }
  } catch {}
  return DEFAULT_BRANCHES;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function branchFor(m: { title?: string | null; description?: string | null; date?: Date | null; speaker?: string | null }, config: Branches): string {
  const text = `${m.title ?? ""} ${m.description ?? ""}`;
  // Named in the episode: the clearest sign.
  for (const b of config.branches) {
    if (b.words.some((w) => new RegExp(`(^|[^a-z0-9])${escape(w)}([^a-z0-9]|$)`, "i").test(text))) return b.name;
  }
  // A speaker or a period at a branch.
  const day = m.date ? m.date.toISOString().slice(0, 10) : null;
  for (const b of config.branches) {
    if (!b.speaker && !b.from && !b.to) continue;
    if (b.speaker && b.speaker.toLowerCase() !== (m.speaker ?? "").toLowerCase()) continue;
    if ((b.from || b.to) && !day) continue;
    if (b.from && day! < b.from) continue;
    if (b.to && day! > b.to) continue;
    return b.name;
  }
  return config.main;
}
