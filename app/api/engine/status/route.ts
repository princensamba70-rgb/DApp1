// Statut public du moteur IA : fournisseur actif, modèle, confidentialité.
// Ne contient AUCUN secret (ni clés, ni URL internes complètes).
import { NextResponse } from "next/server";
import { resolveProvider } from "@/lib/agent/provider";

export const dynamic = "force-dynamic";

export async function GET() {
  const s = resolveProvider();
  return NextResponse.json({
    engine: {
      provider: s.provider,
      label: s.label,
      model: s.model,
      demo: s.demo,
      external: s.external,
      ready: s.ready,
    },
  });
}
