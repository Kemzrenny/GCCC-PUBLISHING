import ExcelJS from "exceljs";
import type { Cell } from "./glory-sheet";

// Turns the uploaded schedule workbook's MASTER SHEET into plain cells (text, link, date).
export async function masterSheetCells(buffer: ArrayBuffer | Buffer): Promise<Cell[][]> {
  const wb = new ExcelJS.Workbook();
  // exceljs's types predate Node's generic Buffer.
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const ws = wb.worksheets.find((w) => /master/i.test(w.name)) ?? wb.worksheets.find((w) => w.actualRowCount > 0);
  if (!ws) throw new Error("The workbook has no sheets.");
  const rows: Cell[][] = [];
  ws.eachRow({ includeEmpty: true }, (row, n) => {
    const cells: Cell[] = [];
    for (let c = 1; c <= Math.max(row.cellCount, 14); c++) cells.push(toCell(row.getCell(c)));
    rows[n - 1] = cells;
  });
  return Array.from(rows, (r) => r ?? []);
}

function toCell(cell: ExcelJS.Cell): Cell {
  const v = cell.value as unknown;
  let link: string | null = cell.hyperlink ?? null;
  let text = "";
  let date: Date | null = null;
  if (v instanceof Date) {
    date = v;
    text = v.toISOString().slice(0, 10);
  } else if (v && typeof v === "object") {
    const o = v as { text?: unknown; hyperlink?: string; richText?: { text: string }[]; result?: unknown };
    if (o.hyperlink) link = o.hyperlink;
    if (o.richText) text = o.richText.map((t) => t.text).join("");
    else if (typeof o.text === "string") text = o.text;
    else if (o.text && typeof o.text === "object" && "richText" in (o.text as object)) text = ((o.text as { richText: { text: string }[] }).richText ?? []).map((t) => t.text).join("");
    else if (o.result instanceof Date) date = o.result;
    else if (o.result != null) text = String(o.result);
  } else if (v != null) text = String(v);
  return { text: text.trim(), link, date };
}
