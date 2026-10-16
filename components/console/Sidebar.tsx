"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "next-auth/react";

type SessionItem = { id: string; title: string; mode: string; updatedAt: string };
type SidebarUser = { name: string; username: string | null; role: string; image: string | null };

export default function Sidebar({ user }: { user: SidebarUser }) {
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  const load = useCallback(async () => {
    const res = await fetch("/api/sessions");
    if (res.ok) {
      const data = await res.json();
      setSessions(data.sessions ?? []);
    }
  }, []);

  // Chargement des sessions : le setState a lieu après le fetch (asynchrone).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load, pathname]);
  useEffect(() => {
    const h = () => load();
    window.addEventListener("cortexp:sessions-changed", h);
    return () => window.removeEventListener("cortexp:sessions-changed", h);
  }, [load]);

  async function deleteSession(id: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    await fetch(`/api/sessions/${id}`, { method: "DELETE" });
    setSessions((s) => s.filter((x) => x.id !== id));
    if (pathname === `/c/${id}`) router.push("/c");
  }

  const content = (
    <aside className="w-[260px] shrink-0 h-full border-r border-line bg-bg-1 flex flex-col font-mono text-sm">
      <div className="p-3 border-b border-line">
        <Link href="/c" className="block text-lg font-bold tracking-tight">
          CORTE<span className="text-accent">XP</span>
        </Link>
        <Link
          href="/c"
          className="mt-3 flex items-center gap-2 w-full border border-line rounded-lg px-3 py-2 text-xs hover:border-accent hover:text-accent transition-colors"
        >
          + Nouvelle session
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto p-2 space-y-0.5" aria-label="Sessions">
        {sessions.length === 0 && (
          <p className="text-fg-2 text-xs px-2 py-3">Aucune session. Lance ton premier objectif.</p>
        )}
        {sessions.map((s) => (
          <Link
            key={s.id}
            href={`/c/${s.id}`}
            className={`group flex items-center gap-2 px-2 py-1.5 rounded-md text-xs truncate transition-colors ${
              pathname === `/c/${s.id}` ? "bg-bg-2 text-fg-0" : "text-fg-1 hover:bg-bg-2 hover:text-fg-0"
            }`}
          >
            <span className={s.mode === "kingly" ? "text-king" : "text-accent"}>
              {s.mode === "kingly" ? "♛" : "◇"}
            </span>
            <span className="flex-1 truncate">{s.title}</span>
            <button
              onClick={(e) => deleteSession(s.id, e)}
              className="opacity-0 group-hover:opacity-100 text-fg-2 hover:text-err px-1"
              aria-label={`Supprimer ${s.title}`}
            >
              ×
            </button>
          </Link>
        ))}
      </nav>

      <div className="border-t border-line p-2 space-y-0.5 text-xs">
        {user.role === "ADMIN" && (
          <Link
            href="/admin"
            className={`flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors ${
              pathname.startsWith("/admin") ? "bg-bg-2 text-warn" : "text-warn/80 hover:bg-bg-2 hover:text-warn"
            }`}
          >
            ⬢ Administration
          </Link>
        )}
        <Link
          href="/settings"
          className={`flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors ${
            pathname.startsWith("/settings") ? "bg-bg-2 text-fg-0" : "text-fg-1 hover:bg-bg-2 hover:text-fg-0"
          }`}
        >
          ⚙ Paramètres
        </Link>
        <div className="flex items-center gap-2 px-2 py-2 border-t border-line mt-1">
          <div className="w-6 h-6 rounded-full bg-bg-2 border border-line flex items-center justify-center text-[10px] text-accent uppercase">
            {(user.name || "?").slice(0, 2)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="truncate text-fg-0">{user.name}</div>
            <div className="text-fg-2 text-[10px]">{user.role === "ADMIN" ? "Administrateur" : "Utilisateur"}</div>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="text-fg-2 hover:text-err text-[10px]"
            aria-label="Se déconnecter"
          >
            quitter
          </button>
        </div>
      </div>
    </aside>
  );

  return (
    <>
      {/* Mobile : bouton + drawer */}
      <button
        onClick={() => setOpen(true)}
        className="lg:hidden fixed top-3 left-3 z-40 border border-line rounded-md bg-bg-1 px-2 py-1 font-mono text-xs"
        aria-label="Ouvrir le menu"
      >
        ☰
      </button>
      {open && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="h-full" onClick={(e) => e.stopPropagation()}>{content}</div>
          <div className="flex-1 bg-black/60" onClick={() => setOpen(false)} />
        </div>
      )}
      <div className="hidden lg:block h-full">{content}</div>
    </>
  );
}
