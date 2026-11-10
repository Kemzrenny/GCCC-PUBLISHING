import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEpisodeTitle, parseFeed, normaliseSpeaker, parseDuration } from "../lib/podbean-parse";
import { parseCsv } from "../lib/csv";
import { mapSheet, splitAssignee } from "../lib/sheet-map";
import { parseDayMonthYear, formatDate } from "../lib/dates";

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

test("episode title with date, title and speaker", () => {
  const p = parseEpisodeTitle("02-09-2026 Knowing God and Living Out the Kingdom Pastor Olakunle Zakariya");
  assert.equal(day(p.date), "2026-09-02");
  assert.equal(p.title, "Knowing God and Living Out the Kingdom");
  assert.equal(p.speaker, "Pastor Olakunle Zakariya");
  assert.deepEqual(p.missing, []);
});

test("episode title with separators and a series part", () => {
  const p = parseEpisodeTitle("30-08-2026 | Jesus, King of the North | Finale | Pst. Adesola Zakariya");
  assert.equal(p.title, "Jesus, King of the North | Finale");
  assert.equal(p.speaker, "Pastor Adesola Zakariya");
});

test("two-digit year and abbreviated title", () => {
  const p = parseEpisodeTitle("21-06-26 Saved to Fight III Pst Olakunle Zakariya");
  assert.equal(day(p.date), "2026-06-21");
  assert.equal(p.title, "Saved to Fight III");
  assert.equal(p.speaker, "Pastor Olakunle Zakariya");
});

test("placeholder titles need details", () => {
  assert.deepEqual(parseEpisodeTitle("no title or date").missing, ["title", "date"]);
  assert.deepEqual(parseEpisodeTitle("Deji did not put date and title").missing, ["title", "date"]);
  assert.deepEqual(parseEpisodeTitle("23-07-2026").missing, ["title"]);
  assert.deepEqual(parseEpisodeTitle("The Mindset of a Believer").missing, ["date"]);
});

test("speaker names come out in one form", () => {
  assert.equal(normaliseSpeaker("Pst. Olakunle Zakariya"), "Pastor Olakunle Zakariya");
  assert.equal(normaliseSpeaker("Pastor PK Olawale"), "Pastor P.K. Olawale");
  assert.equal(normaliseSpeaker("Pastor P.K. Olawale"), "Pastor P.K. Olawale");
  assert.equal(normaliseSpeaker("Aps. Brandon Bailey"), "Apostle Brandon Bailey");
});

test("feed items", () => {
  const xml = `<rss><channel><title>GCCC</title>
  <item><title><![CDATA[02-09-2026 Knowing God &amp; the Kingdom Pastor Olakunle Zakariya]]></title>
  <link>https://gcccpodcasts.podbean.com/e/02-09-2026-x/</link>
  <guid isPermaLink="false">gcccpodcasts.podbean.com/abc</guid>
  <pubDate>Wed, 03 Sep 2026 10:00:00 +0100</pubDate>
  <enclosure url="https://mcdn.podbean.com/mf/web/abc/file.mp3" length="1" type="audio/mpeg"/>
  <itunes:duration>01:12:30</itunes:duration></item>
  </channel></rss>`;
  const [e] = parseFeed(xml);
  assert.equal(e.guid, "gcccpodcasts.podbean.com/abc");
  assert.equal(e.title, "02-09-2026 Knowing God & the Kingdom Pastor Olakunle Zakariya");
  assert.equal(e.audioUrl, "https://mcdn.podbean.com/mf/web/abc/file.mp3");
  assert.equal(e.durationSec, 4350);
  assert.equal(parseDuration("3600"), 3600);
});

test("dates", () => {
  assert.equal(day(parseDayMonthYear("09-08-2028")), "2028-08-09");
  assert.equal(parseDayMonthYear("31-02-2026"), null);
  assert.equal(formatDate(new Date(Date.UTC(2026, 8, 2))), "2 Sep 2026");
});

test("assignee with month", () => {
  assert.deepEqual(splitAssignee("VICTOR and Hannie(October)"), { name: "Victor and Hannie", due: "October" });
  assert.deepEqual(splitAssignee("SHOLA"), { name: "Shola", due: null });
});

test("sheet export with a dashboard above the table", () => {
  const csv = [
    "CENTRAL CONTENT SYSTEM OVERVIEW,,,",
    "TOTAL MESSAGES,TRANSCRIBED,,",
    "1386,401,,",
    "",
    'ID,Date,Title,Speaker,Location,Series,Original Message Link,Transcription status,Transcription link,Message Summary,Glory Home Manual Status,Glory Home Manual Link,Teachers Guide Link,Writer,Manual Code,Manual Topic,Tract potential,Book/booklet potential,Related themes,Assigned person,Current stage,Final content link,Language adaptation status',
    '86,12-03-2026,Navigating Spiritual Order,Pst. Olakunle Zakariya,"Ojodu, Lagos, Nigeria",Word of God & Kingdom Teachings,https://gcccpodcasts.podbean.com/e/12-03-2026-x/,Done,https://docs.google.com/document/d/1/edit,,,,,,,The Most Important Prayer You Will Pray,,,"Prayer, Order",NDIFREKE(September),,,',
    '82,22-03-2026,Sonship in Christ,Pst. Olakunle Zakariya,"Ojodu, Lagos, Nigeria",Word of God & Kingdom Teachings,https://gcccpodcasts.podbean.com/e/22-03-2026/,,,,,,,,,,,,,VICTOR and Hannie(October),,,',
    ',,,,,,,,,,,,,,,,,,,,,,',
  ].join("\n");
  const { rows, error } = mapSheet(parseCsv(csv));
  assert.equal(error, undefined);
  assert.equal(rows.length, 2);
  const [a, b] = rows;
  assert.equal(a.legacyId, 86);
  assert.equal(a.transcribed, true);
  assert.equal(a.speaker, "Pastor Olakunle Zakariya");
  assert.equal(a.location, "Ojodu, Lagos, Nigeria");
  assert.deepEqual(a.themes, ["Prayer", "Order"]);
  assert.equal(a.assigneeName, "Ndifreke");
  assert.equal(a.manual?.title, "The Most Important Prayer You Will Pray");
  assert.equal(b.transcribed, false);
  assert.equal(b.dueLabel, "October");
  assert.equal(b.manual, null);
});

test("future dates and overdue months", async () => {
  const { monthOverdue } = await import("../lib/dates");
  const now = new Date(Date.UTC(2026, 10, 9));
  assert.equal(monthOverdue("October", now), true);
  assert.equal(monthOverdue("November", now), false);
  assert.equal(monthOverdue("Soon", now), false);
});

test("Google Doc name and contents", async () => {
  const { docName, docHtml, folderYear } = await import("../lib/drive-doc");
  const m = { title: "Knowing God & the <Kingdom>", date: new Date(Date.UTC(2026, 8, 2)), speaker: "Pastor Olakunle Zakariya" };
  assert.equal(docName(m), "2026-09-02 Knowing God & the <Kingdom> (Pastor Olakunle Zakariya)");
  assert.equal(folderYear(null), "Undated");
  const html = docHtml({ ...m, series: null, location: "Ojodu", sourceUrl: null, portalUrl: "https://x/messages/1", summary: null, themes: ["Sonship"], scriptures: [], text: "Para one.\n\nPara two & more.", approved: false, approvedAt: null, reviewer: null });
  assert.match(html, /<h1>Knowing God &amp; the &lt;Kingdom&gt;<\/h1>/);
  assert.match(html, /<p>Para one\.<\/p>\n<p>Para two &amp; more\.<\/p>/);
  assert.match(html, /AI draft, not yet reviewed/);
  assert.match(html, /Themes:<\/b> Sonship/);
});

test("audio from a Podbean episode page", async () => {
  const { audioFromEpisodePage, isPodbeanEpisode, urlVariants } = await import("../lib/podbean-parse");
  const ld = `<script type="application/ld+json">{"@type":"PodcastEpisode","url":"https:\\/\\/gcccpodcasts.podbean.com\\/e\\/x\\/","associatedMedia":{"@type":"MediaObject","contentUrl":"https:\\/\\/mcdn.podbean.com\\/mf\\/web\\/abc\\/file.mp3"}}</script>`;
  assert.equal(audioFromEpisodePage(ld), "https://mcdn.podbean.com/mf/web/abc/file.mp3");
  assert.equal(audioFromEpisodePage(`<meta property="og:audio" content="https://mcdn.podbean.com/mf/web/d/e.mp3?x=1&amp;y=2">`), "https://mcdn.podbean.com/mf/web/d/e.mp3?x=1&y=2");
  assert.equal(audioFromEpisodePage(`<div data-src="https://mcdn.podbean.com/mf/play/z/q.m4a"></div>`), "https://mcdn.podbean.com/mf/play/z/q.m4a");
  assert.equal(audioFromEpisodePage("<html>nothing</html>"), null);
  assert.equal(isPodbeanEpisode("https://gcccpodcasts.podbean.com/e/22-03-2026/"), true);
  assert.equal(isPodbeanEpisode("https://docs.google.com/x"), false);
  assert.ok(urlVariants("https://gcccpodcasts.podbean.com/e/abc").includes("https://gcccpodcasts.podbean.com/e/abc/"));
});

test("speaker groups from the real dropdown", async () => {
  const { groupSpeakers } = await import("../lib/speaker-groups");
  const names = ["Pastor Kunle Zakariya", "Pastor Olakunle Zakariya", "Glory Centre Community Church", "Pastor Obi Esiobu", "Pastor Olaoluwa Faniyi", "Pastor Olaolu Faniyi", "Prophet Ayo Jeje", "Pastor Adesola Zakariya", "Apostle Brandon Bailey", "Pastor Obi", "Pastor Akorede Zakariya", "Pastor Seyi Adefemi", "Pastor Korede Zakariya", "Pastor Anu Faniyi", "Pastor Joshua Obeng", "Pastor Kunle Olawale", "Rev. Kayode Oyegoke", "Pastor Laolu Faniyi", "Pastor Deji Akinsanya", "Pastor Ayo Jeje", "Apostle Gideon Odoma", "Pastor Kunle Zakariy", "Pastor Tunji Adeyinka", "Prophetess Fanny", "Pastor Zerubbabel Mengistu", "Pastor Deji", "Pastor Idara Esiobu", "Apostle Anselm Madubuko", "Pastor Desola Zakariya", "Pastor kunle Zakariya"];
  const counts = names.map((name, i) => ({ name, count: name === "Pastor Olakunle Zakariya" ? 900 : 30 - i }));
  const groups = groupSpeakers(counts);
  const find = (n: string) => groups.find((g) => g.names.some((x) => x.name === n));
  const set = (n: string) => new Set(find(n)?.names.map((x) => x.name));
  assert.deepEqual(set("Pastor Kunle Zakariya"), new Set(["Pastor Olakunle Zakariya", "Pastor Kunle Zakariya", "Pastor Kunle Zakariy", "Pastor kunle Zakariya"]));
  assert.equal(find("Pastor Kunle Zakariya")?.suggested, "Pastor Olakunle Zakariya");
  assert.deepEqual(set("Pastor Laolu Faniyi"), new Set(["Pastor Olaoluwa Faniyi", "Pastor Olaolu Faniyi", "Pastor Laolu Faniyi"]));
  assert.deepEqual(set("Pastor Desola Zakariya"), new Set(["Pastor Adesola Zakariya", "Pastor Desola Zakariya"]));
  assert.deepEqual(set("Pastor Korede Zakariya"), new Set(["Pastor Akorede Zakariya", "Pastor Korede Zakariya"]));
  assert.deepEqual(set("Pastor Ayo Jeje"), new Set(["Prophet Ayo Jeje", "Pastor Ayo Jeje"]));
  assert.deepEqual(set("Pastor Obi"), new Set(["Pastor Obi Esiobu", "Pastor Obi"]));
  assert.deepEqual(set("Pastor Deji"), new Set(["Pastor Deji Akinsanya", "Pastor Deji"]));
  // Different people stay apart.
  assert.equal(find("Pastor Anu Faniyi"), undefined);
  assert.equal(find("Pastor Idara Esiobu"), undefined);
  assert.equal(find("Pastor Kunle Olawale"), undefined);
  assert.ok(!set("Pastor Adesola Zakariya").has("Pastor Akorede Zakariya"));
  console.log(groups.map((g) => `${g.suggested} <= ${g.names.map((n) => n.name).join(" | ")}`).join("\n"));
});
