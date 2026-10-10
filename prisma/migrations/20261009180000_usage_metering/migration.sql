-- AlterTable
ALTER TABLE "User" ADD COLUMN "stripeCustomerId" TEXT;

-- AlterTable
ALTER TABLE "Deployment" ADD COLUMN "startedAt" TIMESTAMP(3),
ADD COLUMN "stoppedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "BandwidthDay" (
    "id" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "bytes" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "BandwidthDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageCursor" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "logOffset" BIGINT NOT NULL DEFAULT 0,
    "reportedUntil" TIMESTAMP(3),

    CONSTRAINT "UsageCursor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BandwidthDay_host_day_key" ON "BandwidthDay"("host", "day");
