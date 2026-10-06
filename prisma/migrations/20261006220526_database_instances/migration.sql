-- CreateTable
CREATE TABLE "DatabaseInstance" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dbName" TEXT NOT NULL,
    "dbUser" TEXT NOT NULL,
    "dbPassword" TEXT NOT NULL,
    "host" TEXT NOT NULL DEFAULT '127.0.0.1',
    "port" INTEGER NOT NULL DEFAULT 5432,
    "pooledPort" INTEGER NOT NULL DEFAULT 6543,
    "projectId" TEXT,
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DatabaseInstance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DatabaseInstance_dbName_key" ON "DatabaseInstance"("dbName");

-- CreateIndex
CREATE UNIQUE INDEX "DatabaseInstance_dbUser_key" ON "DatabaseInstance"("dbUser");

-- CreateIndex
CREATE UNIQUE INDEX "DatabaseInstance_projectId_key" ON "DatabaseInstance"("projectId");

-- AddForeignKey
ALTER TABLE "DatabaseInstance" ADD CONSTRAINT "DatabaseInstance_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatabaseInstance" ADD CONSTRAINT "DatabaseInstance_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "DatabaseInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;
