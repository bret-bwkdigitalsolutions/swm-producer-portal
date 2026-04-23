import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg", "pg", "sharp"],
  serverActions: {
    bodySizeLimit: "10mb",
  },
};

export default nextConfig;
