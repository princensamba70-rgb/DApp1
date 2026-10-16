// `prisma generate` portable (Linux / macOS / Windows).
// engineType=client : aucun binaire Prisma n'est nécessaire à l'exécution.
// Sur les environnements au réseau restreint, les overrides ci-dessous évitent
// tout téléchargement de moteur (ils pointent vers un binaire factice).
import { spawnSync } from "node:child_process";

const env = { ...process.env };
if (process.platform !== "win32") {
  env.PRISMA_SCHEMA_ENGINE_BINARY ??= "/bin/true";
  env.PRISMA_QUERY_ENGINE_LIBRARY ??= "/bin/true";
}

const res = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["prisma", "generate"],
  { stdio: "inherit", env, shell: process.platform === "win32" }
);
process.exit(res.status ?? 1);
