-- AlterTable
ALTER TABLE "Transcript" ADD COLUMN     "driveError" TEXT,
ADD COLUMN     "driveFileId" TEXT,
ADD COLUMN     "driveSyncedAt" TIMESTAMP(3),
ADD COLUMN     "driveUrl" TEXT;

-- CreateIndex
CREATE INDEX "Transcript_driveSyncedAt_idx" ON "Transcript"("driveSyncedAt");
