import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import GitHub from "next-auth/providers/github";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";

export const googleEnabled = Boolean(
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
);
export const githubEnabled = Boolean(
  process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
);

const providers: NextAuthConfig["providers"] = [
  // Mode 1 — identifiants (comptes admin ou utilisateurs simples)
  Credentials({
    name: "Identifiants",
    credentials: {
      identifier: { label: "Nom d'utilisateur ou email" },
      password: { label: "Mot de passe", type: "password" },
    },
    async authorize(credentials) {
      const identifier = String(credentials?.identifier ?? "").trim();
      const password = String(credentials?.password ?? "");
      if (!identifier || !password) return null;

      const user = await prisma.user.findFirst({
        where: { OR: [{ username: identifier }, { email: identifier }] },
      });
      // Comparaison en temps quasi constant même si l'utilisateur n'existe pas
      const hash =
        user?.passwordHash ??
        "$2a$12$C6UzMDM.H6dfI/f/IKcEeO7ZBpyPMabIhJZDN0q0kCrGJrJ7T6l6y";
      const ok = await bcrypt.compare(password, hash);
      if (!user || !user.passwordHash || !ok) return null;
      if (!user.isActive) return null;

      await audit({
        actorId: user.id,
        actorName: user.username ?? user.email ?? "?",
        action: "auth.login.credentials",
      });
      return {
        id: user.id,
        name: user.name ?? user.username,
        email: user.email,
        image: user.image,
      };
    },
  }),
];

// Mode 2 — Google OAuth (activé uniquement si les clés sont fournies)
if (googleEnabled) providers.push(Google);
// Mode 3 — GitHub OAuth (activé uniquement si les clés sont fournies)
if (githubEnabled) providers.push(GitHub);

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt", maxAge: 30 * 24 * 3600 },
  trustHost: true,
  pages: { signIn: "/login" },
  providers,
  callbacks: {
    async signIn({ user }) {
      // Bloque les comptes désactivés par l'admin (OAuth inclus)
      if (user?.email) {
        const db = await prisma.user.findFirst({ where: { email: user.email } });
        if (db && !db.isActive) return false;
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user?.id) token.uid = user.id;
      // Rafraîchit rôle / statut depuis la base (révocation immédiate possible)
      if (token.uid) {
        const db = await prisma.user.findUnique({
          where: { id: token.uid as string },
          select: { role: true, isActive: true, username: true, defaultMode: true },
        });
        token.role = db?.role ?? "USER";
        token.active = db?.isActive ?? false;
        token.username = db?.username ?? null;
        token.defaultMode = db?.defaultMode ?? "agent";
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = (token.uid as string) ?? "";
        session.user.role = token.role as string | undefined;
        session.user.username = token.username as string | null | undefined;
        session.user.defaultMode = token.defaultMode as string | undefined;
        session.user.isActive = token.active as boolean | undefined;
      }
      return session;
    },
  },
  events: {
    async signIn({ user, account }) {
      if (account?.provider && account.provider !== "credentials") {
        await audit({
          actorId: user.id,
          actorName: user.email ?? user.name ?? "?",
          action: `auth.login.${account.provider}`,
        });
      }
    },
  },
});

/** Récupère l'utilisateur complet (DB) de la session courante, ou null. */
export async function currentUser() {
  const session = await auth();
  const uid = session?.user?.id;
  if (!uid) return null;
  const user = await prisma.user.findUnique({ where: { id: uid } });
  if (!user || !user.isActive) return null;
  return user;
}

/** Exige un admin actif, sinon lève une erreur 403 gérée par les routes. */
export async function requireAdmin() {
  const user = await currentUser();
  if (!user || user.role !== "ADMIN") return null;
  return user;
}
