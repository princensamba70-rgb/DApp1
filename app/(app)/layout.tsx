import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import Sidebar from "@/components/console/Sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login");

  return (
    <div className="flex-1 flex min-h-0 h-dvh overflow-hidden">
      <Sidebar
        user={{
          name: user.name ?? user.username ?? "Utilisateur",
          username: user.username,
          role: user.role,
          image: user.image,
        }}
      />
      <div className="flex-1 flex flex-col min-w-0">{children}</div>
    </div>
  );
}
