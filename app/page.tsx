import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export default async function LandingPage() {
  const session = await auth();
  if (session?.user?.id) redirect("/c");

  return (
    <main className="flex-1 flex flex-col items-center justify-center px-6">
      <div className="max-w-2xl w-full text-center space-y-8">
        <div className="font-mono">
          <div className="text-xs text-fg-2 mb-3">~/cortexp $</div>
          <h1 className="text-5xl font-bold tracking-tight text-fg-0">
            CORTE<span className="text-accent">XP</span>
          </h1>
          <p className="mt-4 text-fg-1 text-lg">
            Donne un objectif. Récupère un livrable.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-3 text-left font-mono text-sm">
          <div className="border border-line rounded-lg bg-bg-1 p-4">
            <div className="text-accent font-semibold">◇ MODE AGENT</div>
            <p className="text-fg-1 mt-2 text-xs leading-relaxed">
              Agent autonome : planifie, exécute dans une sandbox, lit ses
              erreurs, se corrige et livre un résultat tangible.
            </p>
          </div>
          <div className="border border-line rounded-lg bg-bg-1 p-4">
            <div className="text-king font-semibold">♛ MODE KINGLY 1</div>
            <p className="text-fg-1 mt-2 text-xs leading-relaxed">
              Sur-ensemble strict : orchestration multi-agents, vérificateur
              indépendant, deep research citée, audit complet.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-center gap-3">
          <Link
            href="/login"
            className="px-6 py-2.5 rounded-lg bg-accent text-bg-0 font-mono font-semibold text-sm hover:opacity-90 transition-opacity"
          >
            Se connecter →
          </Link>
        </div>

        <p className="text-fg-2 text-xs font-mono">
          3 modes de connexion : identifiants · Google · GitHub
        </p>
      </div>
    </main>
  );
}
