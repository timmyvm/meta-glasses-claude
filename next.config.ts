import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // Stockfish (WASM) and sharp load native/binary files at runtime: keep them
  // out of the bundle and make sure the engine files ship with /api/step.
  serverExternalPackages: ["stockfish", "sharp"],
  outputFileTracingIncludes: {
    "/api/step": ["./node_modules/stockfish/bin/stockfish-19-lite-single.*"],
  },
  partialPrefetching: true,
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
