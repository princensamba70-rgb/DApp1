"use client";

// Écran de connexion — design clair professionnel (fond blanc, texte noir).
// 3 modes : 1. Identifiants (admin ou utilisateur)  2. Google OAuth  3. GitHub OAuth
import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

function LoginFormInner({ googleEnabled, githubEnabled }: { googleEnabled: boolean; githubEnabled: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const [tab, setTab] = useState<"login" | "register">(
    params.get("tab") === "register" ? "register" : "login"
  );
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [terms, setTerms] = useState(false);
  const [error, setError] = useState<string | null>(
    params.get("error") ? "Connexion impossible. Vérifiez vos identifiants." : null
  );
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await signIn("credentials", { identifier, password, redirect: false });
    setLoading(false);
    if (res?.error) {
      setError("Identifiants invalides ou compte désactivé.");
    } else {
      router.push("/c");
      router.refresh();
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (!terms) { setError("Vous devez accepter les conditions."); return; }
    setLoading(true);
    setError(null);
    const res = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, name, email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setLoading(false);
      setError(data.error ?? "Inscription impossible.");
      return;
    }
    const login = await signIn("credentials", { identifier: username, password, redirect: false });
    setLoading(false);
    if (login?.error) setError("Compte créé — connectez-vous.");
    else { router.push("/c"); router.refresh(); }
  }

  const inputCls =
    "w-full bg-white border border-neutral-300 rounded-lg px-3.5 py-2.5 text-sm text-[#111111] placeholder:text-neutral-400 focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10 focus:outline-none transition-colors";
  const primaryCls =
    "w-full bg-[#111111] text-white rounded-lg py-2.5 font-semibold text-sm hover:bg-neutral-700 disabled:opacity-50 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400";
  const oauthCls =
    "w-full flex items-center justify-center gap-2.5 border border-neutral-300 rounded-lg px-3 py-2.5 text-sm font-medium text-[#111111] bg-white hover:bg-neutral-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-7 shadow-[0_8px_30px_rgba(0,0,0,0.06)] space-y-5">
      {/* Mode 1 — identifiants : onglets segmentés */}
      <div className="flex text-sm bg-neutral-100 rounded-lg p-1" role="tablist">
        <button
          role="tab" aria-selected={tab === "login"}
          onClick={() => { setTab("login"); setError(null); }}
          className={`flex-1 py-2 rounded-md transition-colors ${tab === "login" ? "bg-white text-[#111111] font-semibold shadow-sm" : "text-neutral-500 hover:text-[#111111]"}`}
        >
          Se connecter
        </button>
        <button
          role="tab" aria-selected={tab === "register"}
          onClick={() => { setTab("register"); setError(null); }}
          className={`flex-1 py-2 rounded-md transition-colors ${tab === "register" ? "bg-white text-[#111111] font-semibold shadow-sm" : "text-neutral-500 hover:text-[#111111]"}`}
        >
          Créer un compte
        </button>
      </div>

      {error && (
        <div className="text-red-700 text-sm border border-red-200 bg-red-50 rounded-lg px-3.5 py-2.5" role="alert">
          {error}
        </div>
      )}

      {tab === "login" ? (
        <form onSubmit={handleLogin} className="space-y-3.5">
          <input className={inputCls} placeholder="Nom d'utilisateur ou email" value={identifier}
            onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" required aria-label="Identifiant" />
          <input className={inputCls} type="password" placeholder="Mot de passe" value={password}
            onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required aria-label="Mot de passe" />
          <button type="submit" disabled={loading} className={primaryCls}>
            {loading ? "Connexion…" : "Se connecter"}
          </button>
        </form>
      ) : (
        <form onSubmit={handleRegister} className="space-y-3.5">
          <input className={inputCls} placeholder="Nom d'utilisateur" value={username}
            onChange={(e) => setUsername(e.target.value)} required minLength={3} aria-label="Nom d'utilisateur" />
          <input className={inputCls} placeholder="Nom complet" value={name}
            onChange={(e) => setName(e.target.value)} required aria-label="Nom complet" />
          <input className={inputCls} type="email" placeholder="Email (optionnel)" value={email}
            onChange={(e) => setEmail(e.target.value)} aria-label="Email" />
          <input className={inputCls} type="password" placeholder="Mot de passe (8 caractères min.)" value={password}
            onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" aria-label="Mot de passe" />
          <label className="flex items-center gap-2.5 text-sm text-neutral-600 cursor-pointer">
            <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)}
              className="h-4 w-4 rounded border-neutral-300 accent-[#111111]" />
            J&apos;accepte les conditions d&apos;utilisation
          </label>
          <button type="submit" disabled={loading} className={primaryCls}>
            {loading ? "Création…" : "Créer le compte"}
          </button>
        </form>
      )}

      <div className="flex items-center gap-3 text-neutral-400 text-xs">
        <div className="flex-1 h-px bg-neutral-200" /> ou continuer avec <div className="flex-1 h-px bg-neutral-200" />
      </div>

      {/* Mode 2 — Google */}
      <button className={oauthCls} disabled={!googleEnabled}
        onClick={() => signIn("google", { callbackUrl: "/c" })}
        title={googleEnabled ? "" : "Configurer GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET dans .env"}>
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A11 11 0 0 0 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/></svg>
        Google {!googleEnabled && <span className="text-neutral-400 font-normal">(non configuré)</span>}
      </button>

      {/* Mode 3 — GitHub */}
      <button className={oauthCls} disabled={!githubEnabled}
        onClick={() => signIn("github", { callbackUrl: "/c" })}
        title={githubEnabled ? "" : "Configurer GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET dans .env"}>
        <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.42 7.42 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>
        GitHub {!githubEnabled && <span className="text-neutral-400 font-normal">(non configuré)</span>}
      </button>

      <p className="text-neutral-400 text-xs text-center pt-1">
        Session sécurisée (JWT httpOnly, 30 jours) · protection anti-abus active
      </p>
    </div>
  );
}

export default function LoginForm(props: { googleEnabled: boolean; githubEnabled: boolean }) {
  return (
    <Suspense>
      <LoginFormInner {...props} />
    </Suspense>
  );
}
