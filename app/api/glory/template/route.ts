import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { uploadTemplate } from "@/lib/glory-drive";

// The Members Manual and Teacher's Guide templates every new manual starts from.
export async function POST(req: Request) {
  try {
    await requireUser(["ADMIN"]);
    const form = await req.formData();
    const kind = form.get("kind") === "guide" ? "guide" : "members";
    const file = form.get("file");
    if (!(file instanceof File) || !/\.docx$/i.test(file.name)) return NextResponse.json({ error: "Choose the template as a Word (.docx) file." }, { status: 400 });
    const f = await uploadTemplate(kind, kind === "members" ? "Glory Home Template – Members Manual" : "Glory Home Template – Teacher’s Guide", Buffer.from(await file.arrayBuffer()));
    return NextResponse.json({ ok: true, url: f.webViewLink });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Something went wrong." }, { status: 500 });
  }
}
