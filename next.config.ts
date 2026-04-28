import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  output: "export",
  serverExternalPackages: ["sharp"],
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
