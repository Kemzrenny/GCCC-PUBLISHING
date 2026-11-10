CREATE TYPE "ManualStage" AS ENUM ('PLANNED', 'WRITING', 'REVIEWED', 'SENT', 'TAUGHT');

ALTER TABLE "Manual"
  ADD COLUMN "number" INTEGER,
  ADD COLUMN "stage" "ManualStage" NOT NULL DEFAULT 'PLANNED',
  ADD COLUMN "saturday" DATE,
  ADD COLUMN "plannedMonth" TEXT,
  ADD COLUMN "part" INTEGER,
  ADD COLUMN "parts" INTEGER,
  ADD COLUMN "membersWriter" TEXT,
  ADD COLUMN "guideWriter" TEXT,
  ADD COLUMN "membersDocId" TEXT,
  ADD COLUMN "membersUrl" TEXT,
  ADD COLUMN "guideDocId" TEXT,
  ADD COLUMN "guideUrl" TEXT,
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'portal',
  ADD COLUMN "sourceTitle" TEXT,
  ADD COLUMN "sourceLink" TEXT,
  ADD COLUMN "notes" TEXT,
  ADD COLUMN "importKey" TEXT,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Manuals from the old publishing sheet were written already.
UPDATE "Manual" SET "source" = 'publishing-sheet', "stage" = 'TAUGHT', "membersUrl" = "link";
UPDATE "Manual" SET "number" = CAST(substring("code" from '(\d+)') AS INTEGER) WHERE "code" ~ '\d';

CREATE UNIQUE INDEX "Manual_importKey_key" ON "Manual"("importKey");
CREATE INDEX "Manual_saturday_idx" ON "Manual"("saturday");
CREATE INDEX "Manual_number_idx" ON "Manual"("number");
