import { PrismaClient } from "@prisma/client";
import { PrismaBetterSQLite3 } from "@prisma/adapter-better-sqlite3";
import fs from "node:fs";
import path from "node:path";

// Singleton Prisma avec driver adapter better-sqlite3 (aucun binaire Prisma requis).
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function resolveDbUrl(): string {
  const raw = process.env.DATABASE_URL || "file:./data/cortexp.db";
  const filePath = raw.replace(/^file:/, "");
  const abs = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  return `file:${abs}`;
}

function createClient(): PrismaClient {
  const adapter = new PrismaBetterSQLite3({ url: resolveDbUrl() });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
