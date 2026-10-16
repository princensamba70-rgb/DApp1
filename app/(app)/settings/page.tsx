import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { getTodayUsage } from "@/lib/usage";
import SettingsForm from "@/components/settings/SettingsForm";

export default async function SettingsPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  const usage = await getTodayUsage(user.id);

  return (
    <div className="flex-1 overflow-y-auto px-4 lg:px-8 py-8">
      <div className="max-w-2xl mx-auto space-y-6">
        <header className="font-mono">
          <div className="text-xs text-fg-2">~/cortexp/parametres $</div>
          <h1 className="text-xl font-bold mt-1">Paramètres</h1>
        </header>

        <SettingsForm
          user={{
            name: user.name ?? "",
            username: user.username,
            email: user.email,
            role: user.role,
            plan: user.plan,
            defaultMode: user.defaultMode === "kingly" ? "kingly" : "agent",
            hasPassword: Boolean(user.passwordHash),
            dailyMessageLimit: user.dailyMessageLimit,
          }}
          usedToday={usage.messages}
        />
      </div>
    </div>
  );
}
