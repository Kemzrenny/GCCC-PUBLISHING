import Link from "next/link";
import Prose from "@/components/Prose";
import { contactEmail } from "@/lib/contact";

export const metadata = { title: "About" };

export default function AboutPage() {
  const email = contactEmail();
  return (
    <Prose>
      <span className="eyebrow">GCCC Publishing</span>
      <h1>Every message, preserved.</h1>
      <p>
        The GCCC Publishing portal is the internal tool of the Publishing team of Glory Realms Ministries and Glory Centre Community Church (GCCC),
        Ojodu, Lagos. It keeps a record of the messages preached at the church, turns each one into a written transcript, and tracks what the team
        writes from them: Glory Home manuals, books, booklets and tracts.
      </p>
      <h2>What it does</h2>
      <ul>
        <li>Collects new messages from the church’s Podbean podcast.</li>
        <li>Drafts a transcript of each message with speech-to-text, for a member of the team to check and approve.</li>
        <li>Saves each transcript as a Google Doc in a Drive folder that the Publishing team connects, as a backup.</li>
        <li>Keeps a read-only copy of the message list in the team’s Google Sheet.</li>
      </ul>
      <h2>Who can use it</h2>
      <p>
        Access is by invitation from a Publishing administrator. It isn’t open to the public. If you’re on the team,{" "}
        <Link href="/login">sign in here</Link>.
      </p>
      <h2>Google account access</h2>
      <p>
        An administrator can connect one Google account so the portal can save transcripts to Google Drive. The portal asks only for permission to
        create and manage the files it makes itself. It can’t see or change anything else in that Drive. Read the{" "}
        <Link href="/privacy">privacy policy</Link> for details.
      </p>
      <h2>Contact</h2>
      <p>
        {email ? (
          <>
            Questions about the portal: <a href={`mailto:${email}`}>{email}</a>.
          </>
        ) : (
          "Questions about the portal: contact the Publishing team at Glory Centre Community Church, Ojodu, Lagos."
        )}
      </p>
    </Prose>
  );
}
