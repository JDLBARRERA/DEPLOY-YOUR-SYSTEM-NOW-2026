-- CreateEnum
CREATE TYPE "DatabaseType" AS ENUM ('POSTGRES', 'REDIS');

-- CreateTable
CREATE TABLE "Database" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "DatabaseType" NOT NULL,
    "connectionString" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Database_pkey" PRIMARY KEY ("id")
);
