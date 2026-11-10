import Prose from "@/components/Prose";
import { contactEmail } from "@/lib/contact";

export const metadata = { title: "Privacy policy" };

export default function PrivacyPage() {
  const email = contactEmail();
  const contact = email ? <a href={`mailto:${email}`}>{email}</a> : "the Publishing team at Glory Centre Community Church, Ojodu, Lagos";
  return (
    <Prose>
      <span className="eyebrow">GCCC Publishing</span>
      <h1>Privacy policy</h1>
      <p className="text-muted">Effective 10 November 2026</p>
      <p>
        This policy explains what information the GCCC Publishing portal (“the portal”) keeps and how it’s used. The portal is run by Glory Realms
        Ministries for the Publishing team of Glory Centre Community Church, Ojodu, Lagos, Nigeria. It is an internal tool, used only by invited
        members of that team.
      </p>

      <h2>Information we keep</h2>
      <ul>
        <li>
          <strong>Team accounts:</strong> each member’s name, email address, role and a securely hashed password. We also record when they last
          used the portal.
        </li>
        <li>
          <strong>Ministry content:</strong> details of messages preached at the church (title, date, speaker, series, location), links to their
          recordings on Podbean, their transcripts and summaries, and the notes the team adds.
        </li>
        <li>
          <strong>A record of changes:</strong> who edited or approved a transcript or changed a message’s details, and when.
        </li>
      </ul>

      <h2>How it’s used</h2>
      <p>
        Only to run the Publishing team’s work: preserving messages, producing and reviewing transcripts, and tracking what is written from them.
        We don’t sell or rent any information, use it for advertising, or share it with anyone outside the ministry except the service providers
        below.
      </p>

      <h2>Google user data</h2>
      <p>
        An administrator may connect a Google account so the portal can save transcripts to Google Drive. The portal requests only these
        permissions:
      </p>
      <ul>
        <li>
          <strong>Google Drive, files created by the portal</strong> (<code>drive.file</code>): to create a “GCCC Publishing Transcripts” folder, and
          to create and update one Google Doc per transcript inside it. The portal cannot see, read, change or delete any other file in that Drive.
        </li>
        <li>
          <strong>Basic account information</strong> (the account’s email address): to show administrators which account the backup is connected to.
        </li>
      </ul>
      <p>
        The portal keeps a key that lets it act for the connected account, stored encrypted, and the IDs and links of the folders and Docs it made.
        It does not keep any other information from the Google account. Google user data is used only to provide this backup. It is not
        transferred to anyone else, not used for advertising, and not used to train AI models. A person reads it only when needed for security,
        to fix a problem, or as required by law.
      </p>
      <p>
        The portal’s use of information received from Google APIs adheres to the{" "}
        <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements.
      </p>
      <p>
        Access can be removed at any time with <strong>Disconnect</strong> in the portal’s Settings, or from the Google account’s{" "}
        <a href="https://myaccount.google.com/connections" target="_blank" rel="noreferrer">
          third-party connections
        </a>{" "}
        page. The Docs already created stay in that Drive and belong to that account.
      </p>

      <h2>Service providers</h2>
      <ul>
        <li>
          <strong>Vercel</strong> hosts the portal and stores sermon audio briefly while it is transcribed. <strong>Neon</strong> hosts the database.
        </li>
        <li>
          <strong>Speech-to-text and AI services</strong> (Google Gemini, and where the team chooses them, OpenAI or ElevenLabs) receive sermon audio to
          transcribe and transcript text to summarise. They receive ministry content only, never team members’ account details or Google user data.
        </li>
        <li>
          <strong>Google Sheets</strong>, if set up, receives a read-only copy of the message list.
        </li>
      </ul>

      <h2>How long we keep it</h2>
      <p>
        Ministry content is kept as part of the church’s archive. Sermon audio copied for transcription is deleted as soon as the transcript is
        made. A team member’s account is kept until an administrator removes it; ask us to delete yours at any time.
      </p>

      <h2>Security</h2>
      <p>
        The portal is served only over HTTPS, passwords are hashed, sign-in sessions are signed, and the Google connection key is encrypted. Only
        invited team members can sign in, and what each can do depends on their role.
      </p>

      <h2>Your choices</h2>
      <p>You can ask to see, correct or delete the personal information we hold about you, or for your account to be removed.</p>

      <h2>Changes</h2>
      <p>If this policy changes, the new version will be posted here with a new effective date.</p>

      <h2>Contact</h2>
      <p>Questions about this policy: {contact}.</p>
    </Prose>
  );
}
