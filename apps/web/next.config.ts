import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Shipped as TypeScript source (packages/shared), compiled here.
  transpilePackages: ["@adcc/shared"],
  // Bottom-left would cover the sidebar footer (Settings link).
  devIndicators: { position: "bottom-right" },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
