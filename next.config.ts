import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.JIANTI_NEXT_DIST_DIR || ".next",
  allowedDevOrigins: ["127.0.0.1"],
  experimental: {
    serverActions: {
      bodySizeLimit: "50mb",
    },
  },
};

export default nextConfig;
