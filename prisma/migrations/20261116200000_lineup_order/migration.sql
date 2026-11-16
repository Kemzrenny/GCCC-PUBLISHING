-- The lined-up messages form one ordered queue.
ALTER TABLE "Manual" ADD COLUMN "queuePosition" INTEGER;

-- Start from the order they were preached.
UPDATE "Manual" m SET "queuePosition" = o.n
FROM (
  SELECT x.id, row_number() OVER (ORDER BY msg."date" NULLS LAST, x."createdAt") AS n
  FROM "Manual" x LEFT JOIN "Message" msg ON msg.id = x."messageId"
  WHERE x."saturday" IS NULL AND x."number" IS NULL AND x."stage" = 'PLANNED'
) o
WHERE m.id = o.id;
