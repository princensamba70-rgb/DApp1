"use client";

import { useState } from "react";

export default function CreateUserForm({ onCreated }: { onCreated: () => void }) {
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("USER");
  const [limit, setLimit] = useState("50");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username,
        name,
        email,
        password,
        role,
        dailyMessageLimit: limit.trim() === "" ? null : Number(limit),
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (res.ok) {
      setMsg({ ok: true, text: `Utilisateur ${username} créé.` });
      setUsername(""); setName(""); setEmail(""); setPassword("");
      onCreated();
    } else {
      setMsg({ ok: false, text: data.error ?? "Erreur." });
    }
  }

  const inputCls =
    "bg-bg-2 border border-line rounded-lg px-3 py-2 text-xs font-mono text-fg-0 placeholder:text-fg-2 focus:border-accent focus:outline-none";

  return (
    <form onSubmit={submit} className="border border-line rounded-xl bg-bg-1 p-4 space-y-3">
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
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
        <input className={inputCls} placeholder="Nom d'utilisateur *" value={username}
          onChange={(e) => setUsername(e.target.value)} required minLength={3} />
        <input className={inputCls} placeholder="Nom complet *" value={name}
          onChange={(e) => setName(e.target.value)} required />
        <input className={inputCls} type="email" placeholder="Email (optionnel)" value={email}
          onChange={(e) => setEmail(e.target.value)} />
        <input className={inputCls} type="password" placeholder="Mot de passe * (8 min.)" value={password}
          onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
        <select className={inputCls} value={role} onChange={(e) => setRole(e.target.value)} aria-label="Rôle">
          <option value="USER">Rôle : USER</option>
          <option value="ADMIN">Rôle : ADMIN</option>
        </select>
        <input className={inputCls} type="number" min={0} placeholder="Limite/jour (vide = ∞)" value={limit}
          onChange={(e) => setLimit(e.target.value)} aria-label="Limite journalière" />
      </div>
      <button
        type="submit"
        disabled={saving}
        className="px-4 py-2 rounded-lg bg-accent text-bg-0 font-mono text-xs font-semibold hover:opacity-90 disabled:opacity-50"
      >
        {saving ? "Création…" : "+ Créer l'utilisateur"}
      </button>
    </form>
  );
}
