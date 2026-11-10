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

test("sentence timings survive edits", async () => {
  const { alignTranscript, splitSentences, currentIndex } = await import("../lib/align");
  assert.deepEqual(splitSentences("Turn to John 3:16. For God so loved the world! Amen?"), ["Turn to John 3:16.", "For God so loved the world!", "Amen?"]);
  const timeline = [
    { start: 0, text: "Good morning church." },
    { start: 3, text: "Turn with me to Romans chapter eight verse fourteen." },
    { start: 9, text: "For as many as are led by the Spirit of God, they are the sons of God." },
    { start: 16, text: "Life in the Spirit is not an event, it is a walk." },
    { start: 21, text: "Say amen somebody." },
  ];
  // A reviewer fixed the reference, merged two sentences into one paragraph and reworded one.
  const edited = "Good morning, church. Turn with me to Romans 8:14.\n\nFor as many as are led by the Spirit of God, they are the sons of God. Life in the Spirit is not one event; it is a daily walk.\n\nSay amen, somebody!";
  const paras = alignTranscript(edited, timeline);
  const flat = paras.flat();
  assert.equal(paras.length, 3);
  assert.equal(flat.length, 5);
  const starts = flat.map((s) => s.start!);
  assert.equal(starts[0], 0);
  assert.ok(Math.abs(starts[1] - 3) < 0.5, `Turn with me ~3s, got ${starts[1]}`);
  assert.ok(Math.abs(starts[2] - 9) < 0.5, `For as many ~9s, got ${starts[2]}`);
  assert.ok(Math.abs(starts[3] - 16) < 0.5, `Life in the Spirit ~16s, got ${starts[3]}`);
  assert.ok(Math.abs(starts[4] - 21) < 0.5, `Say amen ~21s, got ${starts[4]}`);
  assert.equal(currentIndex(starts, 12), 2);
  assert.equal(currentIndex(starts, 0), 0);
  // A sentence rewritten completely still gets a time in order.
  const rewritten = alignTranscript("Good morning church. Something totally new here. For as many as are led by the Spirit of God.", timeline).flat();
  assert.ok(rewritten[1].start! > rewritten[0].start! && rewritten[1].start! < rewritten[2].start!);
  // No timeline: text only.
  assert.equal(alignTranscript("One. Two three four five.", null).flat()[0].start, null);
});

test("Gemini timings are read safely", async () => {
  const { parseClock, cleanTimeline } = await import("../lib/align");
  assert.equal(parseClock("01:05"), 65);
  assert.equal(parseClock("1:02:03"), 3723);
  assert.equal(parseClock("12.5"), 12.5);
  assert.equal(parseClock(7), 7);
  assert.equal(parseClock("soon"), null);
  const t = cleanTimeline(
    { segments: [{ start: "00:00", text: "Hallelujah." }, { start: "00:04", text: " " }, { start: "00:09", text: "Open your Bibles." }, { start: "00:07", text: "Romans eight." }, { start: "15:00", text: "Too late." }, { start: "x", text: "Bad." }] },
    600
  );
  assert.deepEqual(t, [
    { start: 0, text: "Hallelujah." },
    { start: 9, text: "Open your Bibles." },
    { start: 9, text: "Romans eight." },
  ]);
  assert.deepEqual(cleanTimeline({ nope: 1 }), []);
});

test("dates are found anywhere in a title, or taken from the upload day", async () => {
  const { findDateInText } = await import("../lib/dates");
  const { parseEpisodeTitle, episodeDate } = await import("../lib/podbean-parse");
  const d = (x: Date | null | undefined) => (x ? x.toISOString().slice(0, 10) : null);
  assert.equal(d(findDateInText("Faith That Works 23rd July 2023")?.date), "2023-07-23");
  assert.equal(d(findDateInText("Sunday Service | July 23, 2023")?.date), "2023-07-23");
  assert.equal(d(findDateInText("Sun 3 Sept 23 Second Service")?.date), "2023-09-03");
  assert.equal(d(findDateInText("Recorded 2024-02-11")?.date), "2024-02-11");
  assert.equal(findDateInText("Psalm 23 verse 1"), null);
  assert.equal(findDateInText("3 John 2"), null);

  const p = parseEpisodeTitle("The Mindset of a Believer - Sunday 12th March 2023 Pastor Olakunle Zakariya");
  assert.equal(d(p.date), "2023-03-12");
  assert.equal(p.title, "The Mindset of a Believer");
  assert.equal(p.speaker, "Pastor Olakunle Zakariya");
  const q = parseEpisodeTitle("Walking in Dominion 05-11-2023");
  assert.equal(q.title, "Walking in Dominion");
  assert.deepEqual(q.missing, []);

  const now = new Date("2026-11-10T12:00:00Z");
  // Sunday 11pm in Lagos is still Sunday, even though it's Sunday 22:00 UTC.
  const sunday = { title: "The Mindset of a Believer", description: "", pubDate: new Date("2026-03-08T22:00:00Z") };
  assert.deepEqual(episodeDate(sunday, now), { date: new Date("2026-03-08T00:00:00Z"), fromUpload: true });
  assert.deepEqual(episodeDate({ ...sunday, description: "Preached on 14th May 2023 at GCCC Ojodu" }, now), { date: new Date("2023-05-14T00:00:00Z"), fromUpload: false });
  // A typo'd future date in the title is ignored in favour of the upload day.
  assert.equal(episodeDate({ ...sunday, title: "Grace 12-03-2028" }, now)?.fromUpload, true);
});

test("Podbean links match whichever address they were copied from", async () => {
  const { episodeSlug } = await import("../lib/podbean-parse");
  assert.equal(episodeSlug("https://gcccpodcasts.podbean.com/e/Faith-That-Works/"), "faith-that-works");
  assert.equal(episodeSlug("podbean.com/e/faith-that-works?utm=x"), "faith-that-works");
  assert.equal(episodeSlug("https://www.podbean.com/eu/pb-abc"), null);
});

test("an old episode's title and date are read from its Podbean page", async () => {
  const { detailsFromEpisodePage } = await import("../lib/podbean-parse");
  const html = `<html><head><meta property="og:title" content="Faith That Works | GCCC Podcasts" />
  <script type="application/ld+json">{"@context":"https://schema.org/","@type":"PodcastEpisode","url":"https:\\/\\/gcccpodcasts.podbean.com\\/e\\/faith-that-works\\/","name":"Faith That Works Pst Kunle Zakariya","datePublished":"2019-07-23","description":"Preached at GCCC Ojodu on 21st July 2019 \\u2013 part 2","associatedMedia":{"@type":"MediaObject","contentUrl":"https:\\/\\/mcdn.podbean.com\\/mf\\/web\\/abc\\/faith.mp3"},"partOfSeries":{"@type":"PodcastSeries","name":"GCCC Podcasts","url":"https:\\/\\/gcccpodcasts.podbean.com"}}</script></head></html>`;
  const d = detailsFromEpisodePage(html);
  assert.equal(d.title, "Faith That Works Pst Kunle Zakariya");
  assert.equal(d.published?.toISOString().slice(0, 10), "2019-07-23");
  assert.match(d.description, /21st July 2019 – part 2/);
  const og = detailsFromEpisodePage(`<meta content="Grace | Podbean" property="og:title"><meta property="article:published_time" content="2020-01-05T10:00:00Z">`);
  assert.equal(og.title, "Grace");
  assert.equal(og.published?.toISOString().slice(0, 10), "2020-01-05");
  assert.equal(detailsFromEpisodePage("<html></html>").title, null);
});

test("page links show the ends and the pages around the current one", async () => {
  const { pageList } = await import("../components/Pagination");
  assert.deepEqual(pageList(1, 3), [1, 2, 3]);
  assert.deepEqual(pageList(1, 56), [1, 2, 3, 4, 5, "gap", 56]);
  assert.deepEqual(pageList(20, 56), [1, "gap", 19, 20, 21, "gap", 56]);
  assert.deepEqual(pageList(56, 56), [1, "gap", 52, 53, 54, 55, 56]);
});

test("Glory Home: teams take turns by month, deadlines count back from Saturday", async () => {
  const g = await import("../lib/glory");
  const teams = g.DEFAULT_TEAMS;
  const rot = g.DEFAULT_ROTATION; // November 2026 is Shola & Ndifreke's
  assert.equal(g.teamFor("2026-11", teams, rot)?.id, "sn");
  assert.equal(g.teamFor("2026-12", teams, rot)?.id, "vh");
  assert.equal(g.teamFor("2027-01", teams, rot)?.id, "sn");
  assert.equal(g.teamFor("2026-10", teams, rot)?.id, "vh");
  assert.equal(g.teamFor("2027-01", teams, { ...rot, overrides: { "2027-01": "vh" } })?.id, "vh");
  assert.deepEqual(g.saturdaysIn("2026-11").map((d) => d.getUTCDate()), [7, 14, 21, 28]);
  assert.equal(g.addMonths("2026-12", 1), "2027-01");

  const sat = new Date("2026-11-21T00:00:00Z");
  const d = g.deadlines(sat);
  assert.equal(d.review.toISOString(), "2026-11-16T19:00:00.000Z", "Monday 8pm Lagos");
  assert.equal(d.secretariat.getUTCDay(), 2, "Tuesday");
  const tuesday = new Date("2026-11-10T12:00:00Z");
  assert.deepEqual(g.nextStep("WRITING", sat, tuesday), { label: "Next: review on Mon 16 Nov, 8pm, in 6 days", tone: "ok" });
  assert.equal(g.nextStep("WRITING", sat, new Date("2026-11-15T12:00:00Z")).tone, "soon");
  assert.deepEqual(g.nextStep("REVIEWED", sat, new Date("2026-11-18T12:00:00Z")), { label: "Next: to the secretariat by Tue 17 Nov, 1 day late", tone: "late" });
  assert.equal(g.nextStep("TAUGHT", sat).tone, "done");

  assert.deepEqual(g.parseWriters("Victor and Hannie(Jan)"), { members: "Victor", guide: "Hannie", month: 1 });
  assert.deepEqual(g.parseWriters("SHOLA(Feb)"), { members: "Shola", guide: "Shola", month: 2 });
  assert.deepEqual(g.parseWriters("NDI (Nov)"), { members: "Ndifreke", guide: "Ndifreke", month: 11 });
  assert.equal(g.parseWriters("VICTOR/HANNIE(Jan-roll over to March)").guide, "Hannie");
  assert.deepEqual(g.parseManualNumbers("MANUAL 165\nMANUAL 166"), [165, 166]);
  assert.deepEqual(g.folderPath(sat), ["2026 Manuals", "11_November_2026"]);
  assert.equal(g.docTitle("guide", { number: 195, title: "You Need Sight" }), "MANUAL 195 – You Need Sight – Teacher’s Guide");
});

test("Glory Home: the master sheet's rows become manuals", async () => {
  const { readMasterSheet } = await import("../lib/glory-sheet");
  const c = (text: string, link: string | null = null) => ({ text, link });
  const header = ["DATE OF SERMON", "SERMON DAY/SESSION", "SERMON TITLE", "LINK TO SERMON", "Minister", "WRITER", "MANUAL CODE", "MANUAL TOPIC", "MANUAL LINK", "TEACHERS GUIDE LINK", "UPDATE", "STATUS", "RELEASE DATE"].map((t) => c(t));
  const row = (cells: string[]) => cells.map((t) => c(t));
  const rows = [
    header,
    row(["26th July 2025", "UK SERMON", "Beyond The Surface Christianity", "https://www.podbean.com/ei/pb-fygzp-1980a56", "Pastor Olakunle Zakariya", "VICTOR/HANNIE(January)", "MANUAL 160", "IS YOUR CHRISTIANITY ORIGINAL? PART 1", "", "", "", "TAUGHT", "17th January 2026"]),
    row(["", "", "", "", "", "", "MANUAL 161", "PART 2", "", "", "", "TAUGHT", "24th January 2026"]),
    row(["18th October 2025", "UK SERMON", "Dominion", "https://www.podbean.com/ew/pb-7qvbv-19c3441", "", "Ndifreke (February)", "MANUAL 165\nMANUAL 166", "GOD WANTS YOU TO HAVE DOMINION\nUNDERSTANDING REST AS A BELIEVER", "", "", "", "TAUGHT", "21st February 2026"]),
    row(["", "", "", "", "", "Victor and Hannie(AUGUST)", "MANUAL 181", "Everything you need", "", "", "", "TAUGHT", "15th August 2026"]),
    row(["", "", "", "", "", "Victor and Hannie(AUGUST)", "MANUAL 182", "Doctrine", "", "", "", "", ""]),
    row(["GLORY HOME MANUAL SCHEDULE FROM 27TH DECEMBER 2025"]),
    row(["26th March 2026", "", "The Mystery of Salvation", "https://www.podbean.com/ew/pb-4r35q-1b05896", "Pastor Olakunle Zakariya", "NDI (Nov)", "", "", "", "", "", "", ""]),
  ];
  const out = readMasterSheet(rows, new Date("2026-11-10T12:00:00Z"));
  const by = (n: number) => out.find((m) => m.number === n)!;
  assert.equal(by(161).sermon.title, "Beyond The Surface Christianity", "PART 2 row borrows the sermon above");
  assert.equal(by(161).membersWriter, "Victor");
  assert.deepEqual([by(160).part, by(160).parts], [1, 2]);
  assert.equal(by(166).topic, "UNDERSTANDING REST AS A BELIEVER");
  assert.equal(by(166).saturday?.toISOString().slice(0, 10), "2026-02-28", "the second manual on a row is the next Saturday");
  assert.equal(by(181).sermon.title, null, "a different writer doesn't borrow the sermon above");
  assert.equal(by(182).sermon.title, null, "nor does the row after it");
  assert.equal(by(160).stage, "TAUGHT");
  const lined = out.find((m) => !m.number)!;
  assert.equal(lined.plannedMonth, "2026-11");
  assert.equal(lined.membersWriter, "Ndifreke");
});

test("Glory Home: the folder's files are sorted into manuals", async () => {
  const { classify, groupFiles, cleanTitle } = await import("../lib/glory-files");
  assert.equal(cleanTitle("8th April- Growth is Tough Teacher_s Guide.docx"), "Growth is Tough");
  assert.equal(cleanTitle("Embracing God_s Goodness- Teacher_s Manual.docx"), "Embracing God's Goodness");
  assert.equal(cleanTitle("MEMBERS MANUAL 106.docx"), "");
  const f = classify("GLORY HOME FOLDER/MANUAL FOR PRINT/MANUALS FOR REVIEW/TO GLORY HOME SECRETARIAT/Feb 17th/MEMBERS MANUAL 68.docx");
  assert.deepEqual([f.year, f.month, f.day, f.number, f.kind], [2024, 2, 17, 68, "members"], "the year the day was a Saturday");
  assert.equal(classify("G/2026 MANUALS/07_August_2026/Be of Good Cheer - Members Manual.docx").month, 8, "the month's name wins");
  assert.match(classify("G/MANUAL FOR PRINT/2024 Manuals/CAC/TIN_CERTIFICATE.pdf").skip ?? "", /business/);
  assert.match(classify("G/MANUAL FOR PRINT/MANUALS FOR REVIEW/THE WRITING TEAM/HANNIE/Message Transcript.docx").skip ?? "", /draft|transcript/i);
  const groups = groupFiles(
    [
      "G/2024 Manuals/JUNE/23rd June/Member_s Manual -THE REPRESENTATIVE.docx",
      "G/2024 Manuals/JUNE/23rd June/TEACHERS GUIDE - THE REPRESENTATIVE.docx",
      "G/2024 Manuals/JANUARY/6th January/MEMBERS MANUAL.docx",
      "G/2024 Manuals/JANUARY/6th January/TEACHERS_ GUIDE.docx",
      "G/2025 Manuals/JUNE/ASK FOR WISDOM (Member_s Manual).docx",
      "G/2025 Manuals/JUNE/ASK FOR WISDOM (TEACHER_S GUIDE) .docx",
      "G/2025 Manuals/JUNE/ASK FOR WISDOM (Teacher_s Guide).docx",
      "G/2025 Manuals/JUNE/THE CHURCH IS POWERFUL Members Manual.docx",
      "G/2025 Manuals/JUNE/A CHRISTIAN MUST HAVE BOUNDARIES (Teacher_s Guide 136).docx",
      "G/2025 Manuals/JUNE/THE CHURCH IS POWERFUL (Teacher_s Guide 136).docx",
    ].map(classify),
  );
  const t = (s: string) => groups.find((g) => g.title === s)!;
  assert.ok(t("THE REPRESENTATIVE").members && t("THE REPRESENTATIVE").guide);
  const jan = groups.find((g) => g.folder.endsWith("6th January"))!;
  assert.ok(jan.members && jan.guide, "a folder with one of each is one manual");
  assert.equal(t("ASK FOR WISDOM").duplicates.length, 1);
  assert.ok(t("THE CHURCH IS POWERFUL").guide?.name.startsWith("THE CHURCH"), "the guide goes with the matching title, not just the number");
  assert.ok(t("A CHRISTIAN MUST HAVE BOUNDARIES").guide && !t("A CHRISTIAN MUST HAVE BOUNDARIES").members);
});
