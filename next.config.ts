import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Image Docker compacte : next build produit un serveur autonome.
  output: "standalone",
  // Autorise les previews proxifiées (dev derrière un tunnel/proxy).
  allowedDevOrigins: ["*.e2b.app", "localhost", "127.0.0.1"],
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-better-sqlite3", "better-sqlite3"],
};

export default nextConfig;
