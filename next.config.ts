import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Collection requests are dynamic; keep the Node.js route configuration explicit.
  devIndicators: false,
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
