import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { speakerCounts } from "@/lib/speakers";
import { groupSpeakers } from "@/lib/speaker-groups";
import { driveClientConfigured } from "@/lib/drive";
import { PageHeading } from "@/components/ui";
import SettingsNav from "@/components/settings/SettingsNav";

// "Back up all now" and the imports can run for a few minutes.
export const maxDuration = 300;

export default async function SettingsLayout({ children }: LayoutProps<"/settings">) {
  const me = await currentUser();
  if (me.role !== "ADMIN") redirect("/library");
  const [s, speakers, invites] = await Promise.all([
    getSettings(["driveRefreshToken", "driveLastError", "sheetLastError"]),
    speakerCounts(),
    prisma.invite.count(),
  ]);
  const driveProblem = !driveClientConfigured() || !s.driveRefreshToken || !!s.driveLastError || !!s.sheetLastError;
  return (
    <>
      <PageHeading eyebrow="Settings" title="Run the portal." />
      <div className="grid gap-6 lg:grid-cols-[15.5rem_minmax(0,1fr)] lg:gap-8">
        <SettingsNav flags={{ connections: driveProblem ? "alert" : null, speakers: groupSpeakers(speakers).length, team: invites }} />
        <div className="flex min-w-0 flex-col gap-6">{children}</div>
      </div>
    </>
  );
}
