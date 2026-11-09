-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'REVIEWER', 'WRITER', 'VIEWER');

-- CreateEnum
CREATE TYPE "TranscriptStatus" AS ENUM ('NOT_STARTED', 'QUEUED', 'TRANSCRIBING', 'AI_DRAFT', 'IN_REVIEW', 'APPROVED', 'FAILED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'VIEWER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActiveAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "passwordChangedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invite" (
    "email" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'VIEWER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invitedById" TEXT,

    CONSTRAINT "Invite_pkey" PRIMARY KEY ("email")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "legacyId" INTEGER,
    "podbeanGuid" TEXT,
    "sourceUrl" TEXT,
    "audioUrl" TEXT,
    "durationSec" INTEGER,
    "podbeanTitle" TEXT,
    "title" TEXT NOT NULL,
    "date" DATE,
    "speaker" TEXT,
    "location" TEXT,
    "series" TEXT,
    "needsDetails" BOOLEAN NOT NULL DEFAULT false,
    "detailsLocked" BOOLEAN NOT NULL DEFAULT false,
    "suggestedTitle" TEXT,
    "status" "TranscriptStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "externalTranscriptUrl" TEXT,
    "summary" TEXT,
    "themes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "scriptures" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tractPotential" BOOLEAN NOT NULL DEFAULT false,
    "bookPotential" BOOLEAN NOT NULL DEFAULT false,
    "assigneeId" TEXT,
    "assigneeName" TEXT,
    "dueDate" DATE,
    "dueLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transcript" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "reviewerId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transcript_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TranscriptVersion" (
    "id" TEXT NOT NULL,
    "transcriptId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TranscriptVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TranscriptionJob" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "step" TEXT NOT NULL DEFAULT 'PREPARE',
    "provider" TEXT NOT NULL,
    "parts" JSONB,
    "nextPart" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "lockedAt" TIMESTAMP(3),
    "batchId" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TranscriptionJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Manual" (
    "id" TEXT NOT NULL,
    "messageId" TEXT,
    "title" TEXT,
    "code" TEXT,
    "link" TEXT,
    "writer" TEXT,
    "status" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Manual_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageEdit" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT,
    "changes" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageEdit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Message_legacyId_key" ON "Message"("legacyId");

-- CreateIndex
CREATE UNIQUE INDEX "Message_podbeanGuid_key" ON "Message"("podbeanGuid");

-- CreateIndex
CREATE UNIQUE INDEX "Message_sourceUrl_key" ON "Message"("sourceUrl");

-- CreateIndex
CREATE INDEX "Message_date_idx" ON "Message"("date");

-- CreateIndex
CREATE INDEX "Message_status_idx" ON "Message"("status");

-- CreateIndex
CREATE INDEX "Message_speaker_idx" ON "Message"("speaker");

-- CreateIndex
CREATE INDEX "Message_needsDetails_idx" ON "Message"("needsDetails");

-- CreateIndex
CREATE UNIQUE INDEX "Transcript_messageId_key" ON "Transcript"("messageId");

-- CreateIndex
CREATE INDEX "TranscriptVersion_transcriptId_createdAt_idx" ON "TranscriptVersion"("transcriptId", "createdAt");

-- CreateIndex
CREATE INDEX "TranscriptionJob_status_createdAt_idx" ON "TranscriptionJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "TranscriptionJob_messageId_idx" ON "TranscriptionJob"("messageId");

-- CreateIndex
CREATE INDEX "Manual_messageId_idx" ON "Manual"("messageId");

-- CreateIndex
CREATE INDEX "MessageEdit_messageId_createdAt_idx" ON "MessageEdit"("messageId", "createdAt");

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transcript" ADD CONSTRAINT "Transcript_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transcript" ADD CONSTRAINT "Transcript_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranscriptVersion" ADD CONSTRAINT "TranscriptVersion_transcriptId_fkey" FOREIGN KEY ("transcriptId") REFERENCES "Transcript"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranscriptVersion" ADD CONSTRAINT "TranscriptVersion_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranscriptionJob" ADD CONSTRAINT "TranscriptionJob_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Manual" ADD CONSTRAINT "Manual_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageEdit" ADD CONSTRAINT "MessageEdit_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageEdit" ADD CONSTRAINT "MessageEdit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
