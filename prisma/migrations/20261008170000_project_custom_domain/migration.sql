-- AlterTable
ALTER TABLE "Project" ADD COLUMN "customDomain" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Project_customDomain_key" ON "Project"("customDomain");
