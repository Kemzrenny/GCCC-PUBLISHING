-- CreateTable
CREATE TABLE "SpeakerAlias" (
    "alias" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpeakerAlias_pkey" PRIMARY KEY ("alias")
);
