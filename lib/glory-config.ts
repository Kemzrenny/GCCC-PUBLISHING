import "server-only";
import { getSettings } from "@/lib/settings";
import { DEFAULT_ROTATION, DEFAULT_TEAMS, type Rotation, type Team } from "@/lib/glory";

export async function gloryConfig(): Promise<{ teams: Team[]; rotation: Rotation }> {
  const s = await getSettings(["gloryTeams", "gloryRotation"]);
  let teams = DEFAULT_TEAMS;
  let rotation = DEFAULT_ROTATION;
  try {
    if (s.gloryTeams) teams = JSON.parse(s.gloryTeams);
  } catch {}
  try {
    if (s.gloryRotation) rotation = { ...DEFAULT_ROTATION, ...JSON.parse(s.gloryRotation) };
  } catch {}
  return { teams, rotation };
}
