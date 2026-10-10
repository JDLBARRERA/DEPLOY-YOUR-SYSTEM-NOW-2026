ALTER TABLE "Project" ADD COLUMN "startCommand" TEXT;
ALTER TABLE "Project" ADD COLUMN "ecosystemId" TEXT;

CREATE TABLE "Ecosystem" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Ecosystem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Ecosystem_name_key" ON "Ecosystem"("name");

ALTER TABLE "Project" ADD CONSTRAINT "Project_ecosystemId_fkey" FOREIGN KEY ("ecosystemId") REFERENCES "Ecosystem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
