import "server-only";
import { prisma } from "@/lib/prisma";
import { branchFor } from "@/lib/branches";
import { branchConfig } from "@/lib/branch-config";

// Messages whose branch the rules would change, grouped by the new branch. Messages someone
// has edited by hand are left as they are.
export async function branchChanges(): Promise<Map<string, string[]>> {
  const config = await branchConfig();
  const rows = await prisma.message.findMany({
    where: { detailsLocked: false },
    select: { id: true, title: true, podbeanTitle: true, date: true, speaker: true, location: true },
  });
  const out = new Map<string, string[]>();
  for (const m of rows) {
    const b = branchFor({ title: m.podbeanTitle ?? m.title, date: m.date, speaker: m.speaker }, config);
    if (b === m.location) continue;
    if (!out.has(b)) out.set(b, []);
    out.get(b)!.push(m.id);
  }
  return out;
}
