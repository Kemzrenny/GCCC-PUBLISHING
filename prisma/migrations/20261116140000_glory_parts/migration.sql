-- Glory Home: series of parts, confirmed part counts, writing progress from the documents,
-- and each message's main sections.
ALTER TABLE "Manual" ADD COLUMN "seriesId" TEXT;
ALTER TABLE "Manual" ADD COLUMN "partsConfirmed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Manual" ADD COLUMN "membersEditedAt" TIMESTAMP(3);
ALTER TABLE "Manual" ADD COLUMN "membersEditedBy" TEXT;
ALTER TABLE "Manual" ADD COLUMN "guideEditedAt" TIMESTAMP(3);
ALTER TABLE "Manual" ADD COLUMN "guideEditedBy" TEXT;
ALTER TABLE "Manual" ADD COLUMN "docsCheckedAt" TIMESTAMP(3);
CREATE INDEX "Manual_seriesId_idx" ON "Manual"("seriesId");
ALTER TABLE "Message" ADD COLUMN "sections" JSONB;
CREATE INDEX "Message_location_idx" ON "Message"("location");

-- Manuals already taught, past, or split are settled; upcoming single manuals wait for the
-- writers to confirm.
UPDATE "Manual" SET "partsConfirmed" = true
WHERE "parts" > 1 OR "stage" IN ('REVIEWED', 'SENT', 'TAUGHT') OR "saturday" < CURRENT_DATE;

-- Parts already planned together form a series: same message, numbered in a run.
UPDATE "Manual" m SET "seriesId" = f.id
FROM (
  SELECT DISTINCT ON ("messageId", "parts") "messageId", "parts", id
  FROM "Manual" WHERE "parts" > 1 AND "messageId" IS NOT NULL AND "saturday" IS NOT NULL
  ORDER BY "messageId", "parts", "saturday"
) f
WHERE m."messageId" = f."messageId" AND m."parts" = f."parts" AND m."saturday" IS NOT NULL;
