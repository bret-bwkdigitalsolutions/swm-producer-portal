import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@googleapis/docs", "@googleapis/drive"],
};

export default nextConfig;
