import { formatDate } from "./dates";

// What a transcript's Google Doc looks like. Plain functions, so they can be tested.

export type DocInput = {
  title: string;
  date: Date | null;
  speaker: string | null;
  series: string | null;
  location: string | null;
  sourceUrl: string | null;
  portalUrl: string;
  summary: string | null;
  themes: string[];
  scriptures: string[];
  text: string;
  approved: boolean;
  approvedAt: Date | null;
  reviewer: string | null;
};

// "2026-09-02 Knowing God and Living Out the Kingdom (Pastor Olakunle Zakariya)": the date
// first so a folder sorts in preaching order.
export function docName(m: { title: string; date: Date | null; speaker: string | null }): string {
  const day = m.date ? m.date.toISOString().slice(0, 10) : "Undated";
  const name = `${day} ${m.title}${m.speaker ? ` (${m.speaker})` : ""}`;
  return name.replace(/[\r\n\t]+/g, " ").slice(0, 240);
}

export function folderYear(date: Date | null): string {
  return date ? String(date.getUTCFullYear()) : "Undated";
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Google converts this HTML into a Doc: a title, a short details block, then the
// transcript as paragraphs.
export function docHtml(d: DocInput): string {
  const meta = [formatDate(d.date), d.speaker, d.series, d.location].filter(Boolean).map((x) => esc(String(x))).join(" · ");
  const status = d.approved
    ? `Approved transcript${d.reviewer ? `, reviewed by ${esc(d.reviewer)}` : ""}${d.approvedAt ? ` on ${esc(formatDate(d.approvedAt))}` : ""}.`
    : "AI draft, not yet reviewed. Check it against the audio before quoting.";
  const links = [
    d.sourceUrl ? `<a href="${esc(d.sourceUrl)}">Listen on Podbean</a>` : "",
    `<a href="${esc(d.portalUrl)}">Open in the Publishing portal</a>`,
  ]
    .filter(Boolean)
    .join(" · ");
  const paragraphs = d.text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
  const about = [
    d.summary ? `<p><b>Summary:</b> ${esc(d.summary)}</p>` : "",
    d.themes.length ? `<p><b>Themes:</b> ${esc(d.themes.join(", "))}</p>` : "",
    d.scriptures.length ? `<p><b>Scriptures:</b> ${esc(d.scriptures.join(", "))}</p>` : "",
  ].join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(d.title)}</title></head><body>
<h1>${esc(d.title)}</h1>
<p>${meta}</p>
<p><i>${status}</i></p>
<p>${links}</p>
${about}
<h2>Transcript</h2>
${paragraphs}
<p><i>Backed up by the GCCC Publishing portal. Edits made here are not copied back; edit in the portal instead.</i></p>
</body></html>`;
}
