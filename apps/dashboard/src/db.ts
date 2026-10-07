import { PrismaClient } from "@db";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaSchema?: string;
};

const prismaSchema = "env-scope";

if (globalForPrisma.prisma && globalForPrisma.prismaSchema !== prismaSchema) {
  void globalForPrisma.prisma.$disconnect();
  globalForPrisma.prisma = undefined;
}

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.prismaSchema = prismaSchema;
}
