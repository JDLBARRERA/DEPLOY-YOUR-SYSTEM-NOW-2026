-- CreateEnum
CREATE TYPE "DeploymentType" AS ENUM ('PRODUCTION', 'PREVIEW');

-- AlterTable
ALTER TABLE "Deployment" ADD COLUMN     "commitAuthor" TEXT,
ADD COLUMN     "commitMessage" TEXT,
ADD COLUMN     "type" "DeploymentType" NOT NULL DEFAULT 'PRODUCTION';
