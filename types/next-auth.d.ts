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

declare module "next-auth/jwt" {
  interface JWT {
    uid?: string;
    role?: string;
    username?: string | null;
    defaultMode?: string;
    active?: boolean;
  }
}
