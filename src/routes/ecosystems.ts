import type { FastifyInstance } from "fastify";
import { requireAdmin } from "../auth/requireAdmin.js";
import { prisma } from "../db.js";

export async function ecosystemRoutes(app: FastifyInstance): Promise<void> {
  app.get("/ecosystems", { preValidation: requireAdmin }, async () => {
    return prisma.ecosystem.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
  });
}
