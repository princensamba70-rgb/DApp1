// Page de connexion/inscription — harmonisée avec la page d'accueil
// (thème clair : fond blanc, texte noir, via la surcharge .theme-light).
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, googleEnabled, githubEnabled } from "@/lib/auth";
import LoginForm from "@/components/auth/LoginForm";

export default async function LoginPage() {
  const session = await auth();
  if (session?.user?.id) redirect("/c");

  return (
    <main className="theme-light flex-1 flex flex-col bg-white text-[#111111]">
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
