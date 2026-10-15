"use client";

import { useCallback, useEffect, useState } from "react";
import UserTable, { type AdminUser } from "./UserTable";
import CreateUserForm from "./CreateUserForm";

type Stats = {
  totalUsers: number;
  activeUsers: number;
  totalRuns: number;
  messagesToday: number;
  tokensToday: number;
};
type AuditEntry = {
  id: string;
  actorName: string | null;
  action: string;
  target: string | null;
  detail: string | null;
  createdAt: string;
};

export default function AdminDashboard({ adminId }: { adminId: string }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [showAudit, setShowAudit] = useState(false);

  const reload = useCallback(async () => {
    const [u, s] = await Promise.all([fetch("/api/admin/users"), fetch("/api/admin/stats")]);
    if (u.ok) setUsers((await u.json()).users ?? []);
    if (s.ok) {
      const data = await s.json();
      setStats(data.stats);
      setAuditLog(data.audit ?? []);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const cards = stats
    ? [
        { label: "Utilisateurs", value: stats.totalUsers, sub: `${stats.activeUsers} actifs` },
        { label: "Messages aujourd'hui", value: stats.messagesToday, sub: "tous comptes" },
        { label: "Runs totaux", value: stats.totalRuns, sub: "agent + kingly" },
        { label: "Tokens aujourd'hui", value: stats.tokensToday.toLocaleString("fr-FR"), sub: "in + out" },
      ]
    : [];

  return (
    <div className="space-y-6 font-mono">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {cards.map((c) => (
          <div key={c.label} className="border border-line rounded-xl bg-bg-1 p-4">
            <div className="text-2xl font-bold text-fg-0">{c.value}</div>
            <div className="text-xs text-fg-1 mt-1">{c.label}</div>
            <div className="text-[10px] text-fg-2">{c.sub}</div>
          </div>
        ))}
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-fg-0">Utilisateurs</h2>
        <UserTable users={users} adminId={adminId} onChanged={reload} />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-fg-0">Créer un utilisateur</h2>
        <CreateUserForm onCreated={reload} />
      </section>

      <section className="space-y-3">
        <button
          onClick={() => setShowAudit((s) => !s)}
          className="text-sm font-semibold text-fg-0 hover:text-accent transition-colors"
          aria-expanded={showAudit}
        >
          {showAudit ? "▾" : "▸"} Journal d&apos;audit ({auditLog.length} dernières entrées)
        </button>
        {showAudit && (
          <div className="border border-line rounded-xl bg-bg-1 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-fg-2 border-b border-line">
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Acteur</th>
                  <th className="px-3 py-2">Action</th>
                  <th className="px-3 py-2">Cible</th>
                  <th className="px-3 py-2">Détail</th>
                </tr>
              </thead>
              <tbody>
                {auditLog.map((a) => (
                  <tr key={a.id} className="border-b border-line/50 text-fg-1">
                    <td className="px-3 py-1.5 whitespace-nowrap text-fg-2">
                      {new Date(a.createdAt).toLocaleString("fr-FR")}
                    </td>
                    <td className="px-3 py-1.5">{a.actorName ?? "—"}</td>
                    <td className="px-3 py-1.5 text-accent">{a.action}</td>
                    <td className="px-3 py-1.5">{a.target ?? "—"}</td>
                    <td className="px-3 py-1.5 text-fg-2">{a.detail ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
