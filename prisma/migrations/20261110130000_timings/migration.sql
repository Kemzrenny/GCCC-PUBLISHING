-- AlterTable
ALTER TABLE "Transcript" ADD COLUMN     "timeline" JSONB;

-- AlterTable
ALTER TABLE "TranscriptionJob" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'TRANSCRIBE',
ADD COLUMN     "nextTime" INTEGER NOT NULL DEFAULT 0;
