// Page de connexion/inscription — harmonisée avec la page d'accueil
// (thème clair : fond blanc, texte noir, via la surcharge .theme-light).
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser, googleEnabled, githubEnabled } from "@/lib/auth";
import LoginForm from "@/components/auth/LoginForm";

export default async function LoginPage() {
  // currentUser() (et non auth()) : vérifie le compte en base. Un jeton
  // orphelin (utilisateur supprimé) ne provoque plus de boucle de
  // redirection entre /login et /c.
  const user = await currentUser();
  if (user) redirect("/c");

  return (
    <main
      className="theme-light flex-1 flex flex-col bg-white text-[#111111]"
      style={{ backgroundColor: "#ffffff", color: "#111111" }}
    >
      {/* RÈGLE CIBLÉE UNIQUE (justifiée) : le thème global pose `body{background:var(--bg-0)}`
          (sombre). Cette page est servie avec la surcharge .theme-light, mais si un navigateur
          ou un proxy sert encore un globals.css OBSOLÈTE (ancienne image Docker, cache), le body
          resterait sombre. Cette règle, limitée à cette route, garantit le fond blanc demandé
          indépendamment de l'état du cache. Elle ne s'applique à aucune autre page. */}
      <style>{`html, body { background: #ffffff !important; }`}</style>
      <header className="border-b border-neutral-200">
        <div className="mx-auto max-w-6xl px-6 h-16 flex items-center">
          <Link href="/" className="font-mono text-lg font-bold tracking-tight">
            CORTE<span className="text-accent">XP</span>
          </Link>
        </div>
      </header>
      <div className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold tracking-tight">Bienvenue</h1>
            <p className="text-neutral-500 text-sm mt-2">
              Donne un objectif. Récupère un livrable.
            </p>
          </div>
          <LoginForm googleEnabled={googleEnabled} githubEnabled={githubEnabled} />
        </div>
      </div>
    </main>
  );
}
