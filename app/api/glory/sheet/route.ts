import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { importMasterSheet } from "@/lib/glory-import";

// Uploading the Glory Home schedule workbook (its MASTER SHEET tab).
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    await requireUser(["ADMIN"]);
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !/\.xlsx$/i.test(file.name)) return NextResponse.json({ error: "Choose the Glory Home schedule as an Excel (.xlsx) file." }, { status: 400 });
    const result = await importMasterSheet(Buffer.from(await file.arrayBuffer()));
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Something went wrong." }, { status: 500 });
  }
}
