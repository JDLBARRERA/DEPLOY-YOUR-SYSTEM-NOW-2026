-- CreateTable
CREATE TABLE "DatabaseAddon" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "containerName" TEXT NOT NULL,
    "connectionString" TEXT NOT NULL,

    CONSTRAINT "DatabaseAddon_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DatabaseAddon_containerName_key" ON "DatabaseAddon"("containerName");

-- CreateIndex
CREATE INDEX "DatabaseAddon_projectId_idx" ON "DatabaseAddon"("projectId");

-- AddForeignKey
ALTER TABLE "DatabaseAddon" ADD CONSTRAINT "DatabaseAddon_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
