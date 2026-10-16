import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import AdminDashboard from "@/components/admin/AdminDashboard";

// Page protégée côté serveur : seuls les comptes ADMIN actifs y accèdent.
export default async function AdminPage() {
  const admin = await requireAdmin();
  if (!admin) redirect("/c");

  return (
    <div className="flex-1 overflow-y-auto px-4 lg:px-8 py-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <header className="font-mono">
          <div className="text-xs text-fg-2">~/cortexp/admin $</div>
          <h1 className="text-xl font-bold mt-1">
            Administration <span className="text-warn">⬢</span>
          </h1>
          <p className="text-fg-1 text-xs mt-1">
            Gestion des utilisateurs, limites d&apos;utilisation, statistiques et journal d&apos;audit.
          </p>
        </header>
        <AdminDashboard adminId={admin.id} />
      </div>
    </div>
  );
}
