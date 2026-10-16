// Page d'accueil — refonte professionnelle : fond blanc pur, texte noir,
// cartes blanches à bordures discrètes, responsive, accessible au clavier.
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { resolveProvider } from "@/lib/agent/provider";

const EXAMPLES = [
  "Exécute ce script JavaScript et montre la sortie",
  "Analyse ce CSV : min, max, moyenne, médiane",
  "Résume ce rapport et extrais les mots-clés",
  "Lis ces URLs et cite les sources",
];

const FEATURES = [
  {
    icon: "⌘",
    title: "Exécution de code réelle",
    text: "Vos scripts JavaScript sont exécutés dans une VM isolée (délai strict, sans accès système) : sortie console, valeurs et erreurs réelles.",
  },
  {
    icon: "∑",
    title: "Analyse de données",
    text: "CSV : min, max, moyenne, médiane, somme, écart-type par colonne. JSON : validation et formatage. Calculs arithmétiques vérifiés.",
  },
  {
    icon: "¶",
    title: "Analyse documentaire",
    text: "Résumé extractif par scoring de fréquence, mots-clés dominants, statistiques de lecture — calculés localement, sans aucun LLM requis.",
  },
  {
    icon: "⎇",
    title: "Vérification indépendante",
    text: "Mode KINGLY 1 : chaque résultat déterministe est ré-exécuté par un vérificateur et comparé octet par octet — les écarts sont signalés.",
  },
  {
    icon: "⚿",
    title: "Confidentialité par défaut",
    text: "Moteur local : aucune clé requise, aucune donnée envoyée à un tiers. Fournisseur interchangeable (Ollama, LM Studio…) par configuration.",
  },
  {
    icon: "♔",
    title: "Administration complète",
    text: "Gestion des utilisateurs, rôles, quotas journaliers, statistiques d'usage et journal d'audit — réservée au rôle ADMIN.",
  },
];

export default async function LandingPage() {
  const session = await auth();
  if (session?.user?.id) redirect("/c");
  const engine = resolveProvider();

  return (
    <div className="theme-light flex-1 flex flex-col bg-white text-[#111111] font-sans">
      {/* 1-3. Barre de navigation : logo + connexion / inscription */}
      <header className="border-b border-neutral-200">
        <nav
          aria-label="Navigation principale"
          className="mx-auto max-w-6xl px-6 h-16 flex items-center justify-between"
        >
          <Link href="/" className="font-mono text-lg font-bold tracking-tight">
            CORTE<span className="text-accent">XP</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="px-4 py-2 text-sm font-medium text-neutral-700 rounded-lg hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400 transition-colors"
            >
              Se connecter
            </Link>
            <Link
              href="/login?tab=register"
              className="px-4 py-2 text-sm font-medium bg-[#111111] text-white rounded-lg hover:bg-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400 transition-colors"
            >
              Créer un compte
            </Link>
          </div>
        </nav>
      </header>

      <main className="flex-1">
        {/* 4. Section principale */}
        <section className="mx-auto max-w-3xl px-6 pt-20 pb-12 text-center">
          <p className="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-xs font-medium text-neutral-600">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-ok" />
            100 % local — exécution réelle, zéro clé API requise
          </p>
          <h1 className="mt-6 text-4xl sm:text-5xl font-bold tracking-tight leading-tight">
            Un agent IA qui exécute
            <br className="hidden sm:block" /> vos tâches de bout en bout
          </h1>
          <p className="mt-5 text-lg text-neutral-600 max-w-xl mx-auto">
            Exécution de code, analyse de données et de documents, recherche
            citée : CORTEXP planifie, agit, vérifie et livre — en toute autonomie.
          </p>

          {/* 5. Champ de saisie central (redirige vers la connexion) */}
          <form action="/login" method="GET" className="mt-10 max-w-xl mx-auto">
            <div className="flex items-center gap-2 rounded-xl border border-neutral-300 bg-white p-2 shadow-sm focus-within:border-neutral-500 transition-colors">
              <span aria-hidden className="pl-2 font-mono text-sm text-neutral-400">$</span>
              <input
                type="text"
                name="objective"
                placeholder="Décrivez votre objectif…"
                aria-label="Décrivez votre objectif"
                className="flex-1 bg-transparent text-sm text-[#111111] placeholder:text-neutral-400 focus:outline-none px-1 py-2"
              />
              <button
                type="submit"
                className="shrink-0 px-4 py-2 text-sm font-medium bg-[#111111] text-white rounded-lg hover:bg-neutral-700 transition-colors"
              >
                Commencer
              </button>
            </div>
            <p className="mt-2 text-xs text-neutral-500">
              La connexion est requise pour lancer un agent.
            </p>
          </form>

          {/* 6. Exemples de tâches */}
          <ul className="mt-6 flex flex-wrap justify-center gap-2" aria-label="Exemples de tâches">
            {EXAMPLES.map((e) => (
              <li key={e}>
                <Link
                  href="/login"
                  className="inline-block text-xs text-neutral-600 border border-neutral-200 rounded-full px-3 py-1.5 hover:border-neutral-400 hover:text-[#111111] transition-colors"
                >
                  {e}
                </Link>
              </li>
            ))}
          </ul>
        </section>

        {/* 7. Les deux modes de travail */}
        <section className="mx-auto max-w-4xl px-6 py-10">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
              <div className="font-mono text-sm font-semibold text-accent">◇ MODE AGENT</div>
              <p className="mt-2 text-sm text-neutral-600 leading-relaxed">
                Agent autonome : planifie, exécute dans une sandbox, lit ses
                erreurs, se corrige et livre un résultat tangible.
              </p>
            </div>
            <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
              <div className="font-mono text-sm font-semibold text-king">♛ MODE KINGLY 1</div>
              <p className="mt-2 text-sm text-neutral-600 leading-relaxed">
                Sur-ensemble strict : orchestration multi-agents, vérificateur
                indépendant, recherche approfondie citée, audit complet.
              </p>
            </div>
          </div>
        </section>

        {/* 8. Fonctionnalités */}
        <section className="border-t border-neutral-100 bg-neutral-50/50">
          <div className="mx-auto max-w-6xl px-6 py-16">
            <h2 className="text-2xl font-bold tracking-tight text-center">
              Conçu pour le travail sérieux
            </h2>
            <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {FEATURES.map((f) => (
                <div key={f.title} className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
                  <div aria-hidden className="text-xl text-neutral-400">{f.icon}</div>
                  <h3 className="mt-3 font-semibold text-[#111111]">{f.title}</h3>
                  <p className="mt-2 text-sm text-neutral-600 leading-relaxed">{f.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 9. Statut du moteur IA */}
        <section className="mx-auto max-w-6xl px-6 py-10">
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-sm text-neutral-600">
            <span className="inline-flex items-center gap-2 rounded-full border border-neutral-200 px-3 py-1.5">
              <span aria-hidden className="h-2 w-2 rounded-full bg-ok" />
              Moteur IA : {engine.label}
            </span>
            <span className="font-mono text-xs text-neutral-500">{engine.model}</span>
            {!engine.external && (
              <span className="text-xs text-neutral-500">
                — aucune donnée envoyée à un service tiers
              </span>
            )}
          </div>
        </section>
      </main>

      {/* 10. Pied de page */}
      <footer className="border-t border-neutral-200">
        <div className="mx-auto max-w-6xl px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-neutral-500">
          <div className="font-mono">
            CORTE<span className="text-accent">XP</span> — agent autonome
          </div>
          <div className="flex items-center gap-5">
            <Link href="/login" className="hover:text-[#111111] transition-colors">Connexion</Link>
            <Link href="/login?tab=register" className="hover:text-[#111111] transition-colors">Inscription</Link>
            <a href="https://github.com/princensamba70-rgb/DApp1" className="hover:text-[#111111] transition-colors">
              Code source
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
