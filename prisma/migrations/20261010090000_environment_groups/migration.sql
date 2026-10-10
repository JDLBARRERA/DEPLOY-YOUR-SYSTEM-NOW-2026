CREATE TABLE "EnvironmentGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnvironmentGroup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GroupVariable" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,

    CONSTRAINT "GroupVariable_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProjectEnvironmentGroup" (
    "projectId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,

    CONSTRAINT "ProjectEnvironmentGroup_pkey" PRIMARY KEY ("projectId","groupId")
);

CREATE UNIQUE INDEX "EnvironmentGroup_name_key" ON "EnvironmentGroup"("name");

CREATE UNIQUE INDEX "GroupVariable_groupId_key_key" ON "GroupVariable"("groupId", "key");

ALTER TABLE "GroupVariable" ADD CONSTRAINT "GroupVariable_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "EnvironmentGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectEnvironmentGroup" ADD CONSTRAINT "ProjectEnvironmentGroup_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectEnvironmentGroup" ADD CONSTRAINT "ProjectEnvironmentGroup_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "EnvironmentGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
