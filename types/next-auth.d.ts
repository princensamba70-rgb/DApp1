import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role?: string;
      username?: string | null;
      defaultMode?: string;
      isActive?: boolean;
    } & DefaultSession["user"];
  }
}

// Le type JWT réellement utilisé par les callbacks NextAuth est celui de
// "@auth/core/jwt" : c'est ce module qu'il faut augmenter (le bloc
// "next-auth/jwt" ci-dessous n'est qu'un ré-export et n'affecte pas les
// callbacks). `uid` accepte `null` : un jeton orphelin (utilisateur
// supprimé) invalide la session au lieu de laisser un identifiant fantôme.
declare module "@auth/core/jwt" {
  interface JWT {
    uid?: string | null;
    role?: string;
    username?: string | null;
    defaultMode?: string;
    active?: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    uid?: string | null;
    role?: string;
    username?: string | null;
    defaultMode?: string;
    active?: boolean;
  }
}
