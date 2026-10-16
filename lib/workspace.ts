// Accès centralisé et sécurisé aux espaces de travail des sessions.
// - un répertoire isolé par session : data/workspaces/<sessionId>
// - parcours récursif avec politique d'exclusion explicite (ZIP + listings) :
//   jamais de secrets (.env*), jamais d'artefacts lourds (node_modules, caches),
//   jamais de métadonnées internes (.git) dans les archives distribuées.
import fs from "node:fs";
import path from "node:path";

/** Répertoires exclus des listings et des archives (artefacts/caches/VCS). */
const EXCLUDED_DIRS = new Set([
  ".git",
  "node_modules",
  ".npm-cache",
  ".next",
  "dist",
  "build",
  "coverage",
  "__pycache__",
]);

/** Un fichier est exclu s'il peut contenir des secrets ou n'apporte rien. */
export function isExcludedFile(name: string): boolean {
  if (name === ".env.example") return false; // modèle sans valeur secrète : conservé
  if (name.startsWith(".env")) return true; // .env, .env.local, .env.production…
  if (name === ".DS_Store" || name.endsWith(".zip") || name.endsWith(".log")) return true;
  return false;
}

export function workspaceDir(sessionId: string): string {
  return path.join(process.cwd(), "data", "workspaces", sessionId);
}

export type WorkspaceFile = { name: string; size: number; mtime: number };

/**
 * Liste récursive des fichiers du workspace (chemins relatifs, séparateur « / »),
 * en appliquant la politique d'exclusion. Profondeur et volume bornés.
 */
export function listWorkspaceFiles(dir: string, maxFiles = 500): WorkspaceFile[] {
  const out: WorkspaceFile[] = [];
  if (!fs.existsSync(dir)) return out;

  const walk = (abs: string, rel: string, depth: number) => {
    if (depth > 8 || out.length >= maxFiles) return;
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      if (out.length >= maxFiles) return;
      const name = entry.name;
      if (entry.isSymbolicLink()) continue; // jamais suivre un lien symbolique
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(name) || name.startsWith(".")) continue;
        walk(path.join(abs, name), rel ? `${rel}/${name}` : name, depth + 1);
      } else if (entry.isFile()) {
        if (isExcludedFile(name)) continue;
        const st = fs.statSync(path.join(abs, name));
        out.push({ name: rel ? `${rel}/${name}` : name, size: st.size, mtime: st.mtimeMs });
      }
    }
  };
  walk(dir, "", 0);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Valide un chemin relatif fourni par le client et le résout DANS le workspace.
 * Retourne null si le chemin tente de sortir du répertoire autorisé.
 */
export function resolveInWorkspace(dir: string, relPath: string): string | null {
  if (!relPath || relPath.length > 512) return null;
  // segments simples uniquement : lettres/chiffres/._- , jamais « .. » ni absolu
  const segments = relPath.split("/");
  for (const s of segments) {
    if (!/^[\w.-]+$/.test(s) || s === ".." || s === ".") return null;
  }
  const abs = path.resolve(dir, segments.join(path.sep));
  const root = path.resolve(dir) + path.sep;
  if (!abs.startsWith(root)) return null;
  return abs;
}
