import { prisma } from "@/lib/db";

type AuditEntry = {
  actorId?: string | null;
  actorName?: string | null;
  action: string;
  target?: string | null;
  detail?: string | null;
  ip?: string | null;
};

/** Journal d'audit : jamais de secret ni de contenu personnel. */
export async function audit(entry: AuditEntry) {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: entry.actorId ?? null,
        actorName: entry.actorName ?? null,
        action: entry.action,
        target: entry.target ?? null,
        detail: entry.detail ?? null,
        ip: entry.ip ?? null,
      },
    });
  } catch {
    // Le journal ne doit jamais faire échouer l'action métier.
  }
}
