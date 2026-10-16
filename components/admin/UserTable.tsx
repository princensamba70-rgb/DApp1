"use client";

import { useState } from "react";

export type AdminUser = {
  id: string;
  username: string | null;
  email: string | null;
  name: string | null;
  role: string;
  plan: string;
  dailyMessageLimit: number | null;
  isActive: boolean;
  createdAt: string;
  usedToday: number;
};

export default function UserTable({
  users,
  adminId,
  onChanged,
}: {
  users: AdminUser[];
  adminId: string;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function patch(id: string, payload: Record<string, unknown>) {
    setBusy(id);
    setError(null);
    const res = await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setBusy(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Erreur.");
    }
    onChanged();
  }

  async function remove(id: string, label: string) {
    if (!confirm(`Supprimer définitivement ${label} ? Sessions et données incluses.`)) return;
    setBusy(id);
    const res = await fetch(`/api/admin/users/${id}`, { method: "DELETE" });
    setBusy(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Erreur.");
    }
    onChanged();
  }

  async function resetPassword(id: string, label: string) {
    const pwd = prompt(`Nouveau mot de passe pour ${label} (8 caractères min.) :`);
    if (!pwd) return;
    if (pwd.length < 8) { setError("8 caractères minimum."); return; }
    await patch(id, { newPassword: pwd });
  }

  function editLimit(u: AdminUser) {
    const raw = prompt(
      `Limite de messages / jour pour ${u.username ?? u.email} (vide = illimité) :`,
      u.dailyMessageLimit === null ? "" : String(u.dailyMessageLimit)
    );
    if (raw === null) return;
    const trimmed = raw.trim();
    if (trimmed === "") return void patch(u.id, { dailyMessageLimit: null });
    const n = Number(trimmed);
    if (!Number.isInteger(n) || n < 0) { setError("Entier ≥ 0 attendu."); return; }
    void patch(u.id, { dailyMessageLimit: n });
  }

  return (
    <div className="space-y-2">
      {error && (
        <div className="text-err text-xs border border-err/40 bg-err/10 rounded-lg px-3 py-2" role="alert">
          ✗ {error}
        </div>
      )}
      <div className="border border-line rounded-xl bg-bg-1 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-fg-2 border-b border-line">
              <th className="px-3 py-2">Utilisateur</th>
              <th className="px-3 py-2">Rôle</th>
              <th className="px-3 py-2">Plan</th>
              <th className="px-3 py-2">Limite/jour</th>
              <th className="px-3 py-2">Utilisé auj.</th>
              <th className="px-3 py-2">Statut</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const isSelf = u.id === adminId;
              const label = u.username ?? u.email ?? u.id;
              const overQuota =
                u.dailyMessageLimit !== null && u.usedToday >= u.dailyMessageLimit && u.role !== "ADMIN";
              return (
                <tr key={u.id} className={`border-b border-line/50 ${busy === u.id ? "opacity-50" : ""}`}>
                  <td className="px-3 py-2">
                    <div className="text-fg-0">{label} {isSelf && <span className="text-fg-2">(vous)</span>}</div>
                    <div className="text-fg-2 text-[10px]">{u.name ?? "—"} · {u.email ?? "sans email"}</div>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={u.role}
                      disabled={isSelf}
                      onChange={(e) => patch(u.id, { role: e.target.value })}
                      className={`bg-bg-2 border border-line rounded px-1.5 py-1 ${u.role === "ADMIN" ? "text-warn" : "text-fg-1"}`}
                      aria-label={`Rôle de ${label}`}
                    >
                      <option value="USER">USER</option>
                      <option value="ADMIN">ADMIN</option>
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={u.plan}
                      onChange={(e) => patch(u.id, { plan: e.target.value })}
                      className="bg-bg-2 border border-line rounded px-1.5 py-1 text-fg-1"
                      aria-label={`Plan de ${label}`}
                    >
                      <option value="free">free</option>
                      <option value="pro">pro</option>
                      <option value="team">team</option>
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => editLimit(u)}
                      className="border border-line rounded px-2 py-1 hover:border-accent text-fg-1 hover:text-fg-0"
                      title="Modifier la limite journalière"
                    >
                      {u.dailyMessageLimit === null ? "∞" : u.dailyMessageLimit} ✎
                    </button>
                  </td>
                  <td className={`px-3 py-2 ${overQuota ? "text-err" : "text-fg-1"}`}>
                    {u.usedToday}{overQuota && " ⚠"}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => patch(u.id, { isActive: !u.isActive })}
                      disabled={isSelf}
                      className={`rounded px-2 py-1 border ${
                        u.isActive ? "text-ok border-ok/40" : "text-err border-err/40"
                      } disabled:opacity-40`}
                      title={u.isActive ? "Désactiver le compte" : "Réactiver le compte"}
                    >
                      {u.isActive ? "● actif" : "○ désactivé"}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button
                      onClick={() => resetPassword(u.id, label)}
                      className="text-fg-2 hover:text-warn px-1"
                      title="Réinitialiser le mot de passe"
                    >
                      clé
                    </button>
                    <button
                      onClick={() => remove(u.id, label)}
                      disabled={isSelf}
                      className="text-fg-2 hover:text-err px-1 disabled:opacity-30"
                      title="Supprimer le compte"
                    >
                      suppr
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
