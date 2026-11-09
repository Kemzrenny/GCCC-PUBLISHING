# GCCC Publishing Portal

The Publishing team's home for Papi's messages: every message from Podbean, its
transcript, and everything made from it.

Phase 1 (this release):

- **Message library**: every message, filterable by transcript status, speaker and year, with search across titles, series, summaries, themes and scriptures.
- **Podbean import**: the feed is checked every two hours (6am to 10pm Lagos time) and on demand. New episodes are added and, by default, queued for transcription. Episodes whose titles have no usable title or date go to **Needs details**.
- **Transcription**: audio is cut into ~10-minute parts and each part is transcribed by the service chosen in Settings: Google Gemini, OpenAI or ElevenLabs Scribe. Gemini then drafts a summary, themes, scriptures and tract/book potential.
- **Review**: a reviewer corrects the draft against the audio and approves it. Every save is kept as a version.
- **Sheet import**: a one-time (repeatable) import of the old Publishing Central Content System sheet, matched by its ID and Podbean link.
- **Google Sheet mirror**: a read-only copy of the library written to a `Portal` tab of the sheet.
- **Team**: invite-only accounts with four roles: Admin, Reviewer, Writer, Viewer.

Built on the same stack as The Doer Life: Next.js 16, React 19, Tailwind 4, Prisma on Neon
Postgres, Vercel Blob, Gemini and Vercel Cron.

## Setting it up on Vercel

1. Import this repo into Vercel.
2. Add a Neon Postgres database (Storage tab) so `DATABASE_URL` is set. The first deploy creates the tables.
3. Add a **private** Blob store (Storage tab) so `BLOB_READ_WRITE_TOKEN` is set.
4. Add the other variables from `.env.example`: at least `JWT_SECRET`, `ADMIN_EMAILS`, `CRON_SECRET` and `GEMINI_API_KEY`.
5. Deploy, open the site, and create your account with an email from `ADMIN_EMAILS`.
6. In **Settings**: import the sheet (File › Download › CSV from the messages tab), then press **Check now** under Podbean to link the audio.
7. Invite the team from Settings. They create their accounts on the sign-in page with the invited email.

### Trying the transcription services

Add the API keys for the services you want to compare, then pick one in Settings and
transcribe two or three messages. Switch services and transcribe the same messages again
(use **Transcribe in the portal** on a message page) to compare.

## Working on it locally

```bash
npm install
cp .env.example .env.local   # fill in DATABASE_URL and JWT_SECRET at least
npx prisma migrate deploy
npm run dev
```

`npm test` runs the parser tests (Podbean titles, the sheet export, dates).

## How the transcription queue works

A sermon is too long to transcribe within one server request, so each job moves a step
at a time (`lib/jobs.ts`): **PREPARE** downloads the audio and cuts it into parts kept in
Blob, **PART** transcribes the next part, **FINISH** joins the parts and drafts the
summary. `/api/jobs/run` works through as many steps as fit in four minutes, then calls
itself again if work is left. The scheduled round (`/api/cron/work`) also restarts it. A
step that fails is retried twice before the job is marked failed with the reason.
