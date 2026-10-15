// Seed idempotent : crée / synchronise le compte administrateur.
// Le mot de passe est haché avec bcrypt AVANT d'entrer en base : il n'apparaît
// jamais côté navigateur ni dans les réponses API.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { PrismaClient } = require("@prisma/client");
const { PrismaBetterSQLite3 } = require("@prisma/adapter-better-sqlite3");
const bcrypt = require("bcryptjs");
import fs from "node:fs";
import path from "node:path";

const raw = process.env.DATABASE_URL || "file:./data/cortexp.db";
const filePath = raw.replace(/^file:/, "");
const abs = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
fs.mkdirSync(path.dirname(abs), { recursive: true });

const adapter = new PrismaBetterSQLite3({ url: `file:${abs}` });
const prisma = new PrismaClient({ adapter });

const username = process.env.ADMIN_USERNAME || "adminnp";
const password = process.env.ADMIN_PASSWORD || "2026@admin@prince";
const email = process.env.ADMIN_EMAIL || "admin@cortexp.local";

async function main() {
  const passwordHash = await bcrypt.hash(password, 12);
  const admin = await prisma.user.upsert({
    where: { username },
    update: { role: "ADMIN", isActive: true, passwordHash, dailyMessageLimit: null },
    create: {
      username,
      email,
      name: "Administrateur",
      passwordHash,
      role: "ADMIN",
      plan: "team",
      dailyMessageLimit: null,
      isActive: true,
    },
  });
  console.log(`[seed] admin prêt : ${admin.username} (role=${admin.role})`);
}

main()
  .catch((e) => {
    console.error("[seed] erreur :", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
