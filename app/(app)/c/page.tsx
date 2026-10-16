import { currentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import NewSession from "@/components/console/NewSession";

export default async function NewSessionPage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  return (
    <NewSession
      defaultMode={user.defaultMode === "kingly" ? "kingly" : "agent"}
      displayName={user.name ?? user.username ?? "là"}
    />
  );
}
