-- CreateEnum
CREATE TYPE "EnvScope" AS ENUM ('ALL', 'PRODUCTION', 'PREVIEW');

-- CreateTable
CREATE TABLE "EnvVar" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "environment" "EnvScope" NOT NULL DEFAULT 'ALL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnvVar_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EnvVar_projectId_key_environment_key" ON "EnvVar"("projectId", "key", "environment");

-- AddForeignKey
ALTER TABLE "EnvVar" ADD CONSTRAINT "EnvVar_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Copy the flat JSON map into ALL-scoped rows.
INSERT INTO "EnvVar" ("id", "projectId", "key", "value", "environment", "createdAt")
SELECT
    gen_random_uuid()::text,
    project."id",
    entry.key,
    entry.value,
    'ALL'::"EnvScope",
    CURRENT_TIMESTAMP
FROM "Project" AS project
CROSS JOIN LATERAL jsonb_each_text(project."envVars") AS entry(key, value)
WHERE entry.key ~ '^[A-Za-z_][A-Za-z0-9_]*$'
  AND strpos(entry.value, chr(10)) = 0
  AND strpos(entry.value, chr(13)) = 0;
