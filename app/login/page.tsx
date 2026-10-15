import { redirect } from "next/navigation";
import { auth, googleEnabled, githubEnabled } from "@/lib/auth";
import LoginForm from "@/components/auth/LoginForm";

export default async function LoginPage() {
  const session = await auth();
  if (session?.user?.id) redirect("/c");

  return (
    <main className="flex-1 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8 font-mono">
          <div className="text-xs text-fg-2 mb-2">~/cortexp/login $</div>
          <h1 className="text-3xl font-bold">
            CORTE<span className="text-accent">XP</span>
          </h1>
          <p className="text-fg-1 text-sm mt-2">
            Donne un objectif. Récupère un livrable.
          </p>
        </div>
        <LoginForm googleEnabled={googleEnabled} githubEnabled={githubEnabled} />
      </div>
    </main>
  );
}
