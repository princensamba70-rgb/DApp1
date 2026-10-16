"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type SettingsUser = {
  name: string;
  username: string | null;
  email: string | null;
  role: string;
  plan: string;
  defaultMode: "agent" | "kingly";
  hasPassword: boolean;
  dailyMessageLimit: number | null;
};

export default function SettingsForm({ user, usedToday }: { user: SettingsUser; usedToday: number }) {
  const router = useRouter();
  const [name, setName] = useState(user.name);
  const [defaultMode, setDefaultMode] = useState<"agent" | "kingly">(user.defaultMode);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const limit = user.role === "ADMIN" ? null : user.dailyMessageLimit;
  const pct = limit ? Math.min(100, Math.round((usedToday / limit) * 100)) : 0;

  async function save(payload: Record<string, unknown>, successMsg: string) {
    setSaving(true);
    setMsg(null);
    const res = await fetch("/api/account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (res.ok) {
      setMsg({ ok: true, text: successMsg });
      setCurrentPassword("");
      setNewPassword("");
      router.refresh();
    } else {
      setMsg({ ok: false, text: data.error ?? "Erreur." });
    }
  }

  const inputCls =
    "w-full bg-bg-2 border border-line rounded-lg px-3 py-2 text-sm font-mono text-fg-0 placeholder:text-fg-2 focus:border-accent focus:outline-none";
  const cardCls = "border border-line rounded-xl bg-bg-1 p-5 space-y-3";

  return (
    <div className="space-y-5 font-mono text-sm">
      {msg && (
        <div
          className={`text-xs border rounded-lg px-3 py-2 ${
            msg.ok ? "text-ok border-ok/40 bg-ok/10" : "text-err border-err/40 bg-err/10"
          }`}
          role="status"
        >
          {msg.ok ? "✓" : "✗"} {msg.text}
        </div>
      )}

      <section className={cardCls}>
        <h2 className="text-fg-0 font-semibold">Profil</h2>
        <div className="text-xs text-fg-2 space-y-1">
          <p>identifiant : <span className="text-fg-1">{user.username ?? "—"}</span></p>
          <p>email : <span className="text-fg-1">{user.email ?? "—"}</span></p>
          <p>rôle : <span className={user.role === "ADMIN" ? "text-warn" : "text-fg-1"}>{user.role}</span> · plan : <span className="text-fg-1">{user.plan}</span></p>
        </div>
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom affiché" aria-label="Nom affiché" />
        <div className="flex items-center gap-3">
          <label className="text-xs text-fg-1">Mode par défaut :</label>
          <select
            value={defaultMode}
            onChange={(e) => setDefaultMode(e.target.value as "agent" | "kingly")}
            className="bg-bg-2 border border-line rounded-lg px-2 py-1.5 text-xs"
            aria-label="Mode par défaut"
          >
            <option value="agent">◇ Agent</option>
            <option value="kingly">♛ Kingly 1</option>
          </select>
        </div>
        <button
          onClick={() => save({ name, defaultMode }, "Profil mis à jour.")}
          disabled={saving}
          className="px-4 py-2 rounded-lg bg-accent text-bg-0 text-xs font-semibold hover:opacity-90 disabled:opacity-50"
        >
          Enregistrer
        </button>
      </section>

      <section className={cardCls}>
        <h2 className="text-fg-0 font-semibold">Quota journalier</h2>
        <div className="text-xs text-fg-1">
          {limit === null ? (
            <p className="text-ok">Illimité {user.role === "ADMIN" ? "(compte administrateur)" : ""} — {usedToday} message(s) aujourd&apos;hui.</p>
          ) : (
            <>
              <p>
                {usedToday} / {limit} messages utilisés aujourd&apos;hui
                {pct >= 80 && <span className="text-warn ml-2">⚠ {pct}%</span>}
              </p>
              <div className="mt-2 h-1.5 bg-bg-2 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${pct >= 100 ? "bg-err" : pct >= 80 ? "bg-warn" : "bg-ok"}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="text-fg-2 mt-2">La limite est gérée par l&apos;administrateur.</p>
            </>
          )}
        </div>
      </section>

      {user.hasPassword && (
        <section className={cardCls}>
          <h2 className="text-fg-0 font-semibold">Mot de passe</h2>
          <input className={inputCls} type="password" placeholder="Mot de passe actuel" value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" aria-label="Mot de passe actuel" />
          <input className={inputCls} type="password" placeholder="Nouveau mot de passe (8 min.)" value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" aria-label="Nouveau mot de passe" />
          <button
            onClick={() => save({ currentPassword, newPassword }, "Mot de passe modifié.")}
            disabled={saving || newPassword.length < 8}
            className="px-4 py-2 rounded-lg bg-accent text-bg-0 text-xs font-semibold hover:opacity-90 disabled:opacity-50"
          >
            Changer le mot de passe
          </button>
        </section>
      )}
    </div>
  );
}
