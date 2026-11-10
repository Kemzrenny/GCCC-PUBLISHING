import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { importManualFiles } from "@/lib/glory-import";
import { DriveError } from "@/lib/drive";

// One manual's documents from the dragged-in Glory Home folder: its Members Manual and/or
// Teacher's Guide, plus what the folder said about it.
export const maxDuration = 60;

const meta = z.object({
  key: z.string().min(1).max(500),
  title: z.string().max(300),
  year: z.number().int().nullable(),
  month: z.number().int().min(1).max(12).nullable(),
  day: z.number().int().min(1).max(31).nullable(),
  number: z.number().int().nullable(),
  folder: z.string().max(500),
});

export async function POST(req: Request) {
  try {
    await requireUser(["ADMIN"]);
    const form = await req.formData();
    const parsed = meta.safeParse(JSON.parse(String(form.get("meta") ?? "{}")));
    if (!parsed.success) return NextResponse.json({ error: "The manual's details didn't come through." }, { status: 400 });
    const files: { kind: "members" | "guide"; name: string; type: string; data: Buffer }[] = [];
    for (const kind of ["members", "guide"] as const) {
      const f = form.get(kind);
      if (f instanceof File) files.push({ kind, name: f.name, type: f.type, data: Buffer.from(await f.arrayBuffer()) });
    }
    if (!files.length) return NextResponse.json({ error: "No documents came through." }, { status: 400 });
    return NextResponse.json(await importManualFiles(parsed.data, files));
  } catch (err) {
    const raw = err instanceof Error ? err.message : "Something went wrong.";
    const message = /fetch failed|ECONN|ETIMEDOUT/i.test(raw) ? "Couldn't reach Google Drive. Try again in a moment." : raw;
    return NextResponse.json({ error: message, reconnect: err instanceof DriveError && err.reconnect }, { status: 500 });
  }
}
