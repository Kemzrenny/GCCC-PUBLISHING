import Link from "next/link";
import Prose from "@/components/Prose";
import { contactEmail } from "@/lib/contact";

export const metadata = { title: "Terms of service" };

export default function TermsPage() {
  const email = contactEmail();
  const contact = email ? <a href={`mailto:${email}`}>{email}</a> : "the Publishing team at Glory Centre Community Church, Ojodu, Lagos";
  return (
    <Prose>
      <span className="eyebrow">GCCC Publishing</span>
      <h1>Terms of service</h1>
      <p className="text-muted">Effective 10 November 2026</p>
      <p>
        These terms apply to the GCCC Publishing portal (“the portal”), run by Glory Realms Ministries for the Publishing team of Glory Centre
        Community Church, Ojodu, Lagos, Nigeria. By signing in, you agree to them.
      </p>

      <h2>Who may use it</h2>
      <p>
        The portal is for invited members of the Publishing team and others the ministry authorises. Keep your password to yourself and don’t share
        your account. An administrator may change your role or turn off your account at any time.
      </p>

      <h2>Using it properly</h2>
      <ul>
        <li>Use it only for the ministry’s publishing work.</li>
        <li>Don’t try to reach parts of the portal or data your role doesn’t allow, or interfere with how it runs.</li>
        <li>When reviewing a transcript, keep the preacher’s words: correct mistakes, don’t rewrite the message.</li>
      </ul>

      <h2>The ministry’s content</h2>
      <p>
        Messages, recordings, transcripts, summaries and everything written from them belong to Glory Realms Ministries. Don’t publish, sell or
        share them outside the ministry without its permission.
      </p>

      <h2>Transcripts made by AI</h2>
      <p>
        Draft transcripts and summaries are produced by speech-to-text and AI services and can contain mistakes. Only a transcript a team member has
        approved should be treated as accurate, and even then check scripture references before publishing.
      </p>

      <h2>Google Drive</h2>
      <p>
        If an administrator connects a Google account, the portal creates and updates transcript Docs in that account’s Drive, as described in the{" "}
        <Link href="/privacy">privacy policy</Link>. The account’s owner remains responsible for that Drive and can disconnect the portal at any
        time.
      </p>

      <h2>No guarantee</h2>
      <p>
        The portal is provided as is, for the ministry’s internal use. We work to keep it available and its data safe, but can’t promise it will
        always be available or free of errors. Keep important work backed up; the Google Docs backup exists for this.
      </p>

      <h2>Changes</h2>
      <p>These terms may be updated. The new version will be posted here with a new effective date.</p>

      <h2>Contact</h2>
      <p>Questions about these terms: {contact}.</p>
    </Prose>
  );
}
