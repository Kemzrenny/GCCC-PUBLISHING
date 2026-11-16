import "server-only";
import { getSetting } from "@/lib/settings";
import { parseBranches } from "@/lib/branches";

export async function branchConfig() {
  return parseBranches(await getSetting("branches"));
}
