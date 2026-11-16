import { test } from "node:test";
import assert from "node:assert/strict";
import { reschedule } from "../lib/glory-plan";

const sat = (d: string) => new Date(`${d}T00:00:00Z`);
const day = (x: Date) => x.toISOString().slice(0, 10);

// November 2026 Saturdays: 7, 14, 21, 28; then Dec 5, 12, 19.
test("growing to three parts inserts them and moves later manuals back", () => {
  const r = reschedule(
    [{ id: "p1", part: 1, saturday: sat("2026-11-14"), number: 196, removable: false }],
    3,
    [
      { id: "a", saturday: sat("2026-11-21"), number: 197, movable: true },
      { id: "b", saturday: sat("2026-11-28"), number: 198, movable: true },
    ],
  );
  assert.equal(r.error, undefined);
  assert.deepEqual(r.add.map((a) => [a.part, day(a.saturday), a.number]), [[2, "2026-11-21", 197], [3, "2026-11-28", 198]]);
  assert.deepEqual(r.moves.map((m) => [m.id, day(m.to), m.number]), [["a", "2026-12-05", 199], ["b", "2026-12-12", 200]]);
});

test("gaps are kept and fixed manuals stay put", () => {
  const r = reschedule(
    [{ id: "p1", part: 1, saturday: sat("2026-11-07"), number: 10, removable: false }],
    2,
    [
      { id: "fixed", saturday: sat("2026-11-14"), number: 11, movable: false },
      { id: "a", saturday: sat("2026-11-21"), number: 12, movable: true },
      // 28 Nov empty on purpose
      { id: "b", saturday: sat("2026-12-05"), number: 13, movable: true },
    ],
  );
  // Part 2 skips the fixed Saturday.
  assert.deepEqual(r.add.map((a) => [day(a.saturday), a.number]), [["2026-11-21", 12]]);
  assert.deepEqual(r.moves.map((m) => [m.id, day(m.to), m.number]), [["a", "2026-11-28", 13], ["b", "2026-12-12", 14]]);
});

test("shrinking removes parts and pulls later manuals forward", () => {
  const r = reschedule(
    [
      { id: "p1", part: 1, saturday: sat("2026-11-07"), number: 1, removable: false },
      { id: "p2", part: 2, saturday: sat("2026-11-14"), number: 2, removable: true },
      { id: "p3", part: 3, saturday: sat("2026-11-21"), number: 3, removable: true },
    ],
    1,
    [{ id: "a", saturday: sat("2026-11-28"), number: 4, movable: true }],
  );
  assert.deepEqual(r.remove.sort(), ["p2", "p3"]);
  assert.deepEqual(r.moves.map((m) => [m.id, day(m.to), m.number]), [["a", "2026-11-14", 2]]);
});

test("a started part can't be removed", () => {
  const r = reschedule(
    [
      { id: "p1", part: 1, saturday: sat("2026-11-07"), number: 1, removable: false },
      { id: "p2", part: 2, saturday: sat("2026-11-14"), number: 2, removable: false },
    ],
    1,
    [],
  );
  assert.match(r.error ?? "", /Part 2/);
});

test("manuals without numbers keep none, and unnumbered series leave numbers alone", () => {
  const r = reschedule([{ id: "p1", part: 1, saturday: sat("2026-11-07"), number: null, removable: false }], 2, [
    { id: "a", saturday: sat("2026-11-14"), number: 50, movable: true },
  ]);
  assert.equal(r.add[0].number, null);
  assert.deepEqual(r.moves.map((m) => [day(m.to), m.number]), [["2026-11-21", 50]]);
});

import { branchFor, parseBranches } from "../lib/branches";

test("branches come from words, then a speaker's dates, then the main branch", () => {
  const config = parseBranches(
    JSON.stringify({
      main: "Ojodu",
      branches: [
        { name: "Ojodu", words: ["Ojodu"] },
        { name: "UK", words: ["UK", "London"], speaker: "Pastor Olakunle Zakariya", from: "2024-01-01", to: "2024-06-30" },
        { name: "Abuja", words: ["Abuja"] },
      ],
    }),
  );
  assert.equal(branchFor({ title: "Faith | GCCC Abuja" }, config), "Abuja");
  assert.equal(branchFor({ title: "Walking in Dominion", description: "Live from London" }, config), "UK");
  assert.equal(branchFor({ title: "Duke of something" }, config), "Ojodu", "no partial-word match on UK");
  assert.equal(branchFor({ title: "Grace", speaker: "Pastor Olakunle Zakariya", date: new Date("2024-03-10T00:00:00Z") }, config), "UK");
  assert.equal(branchFor({ title: "Grace", speaker: "Pastor Olakunle Zakariya", date: new Date("2024-08-10T00:00:00Z") }, config), "Ojodu");
  assert.equal(branchFor({ title: "Grace", speaker: "Pastor Ade", date: new Date("2024-03-10T00:00:00Z") }, config), "Ojodu");
  assert.equal(parseBranches("not json").main, "Ojodu");
});
