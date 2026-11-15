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
  // Only the ~2MB lite build is used; the full builds are ~94MB each and
  // would blow past serverless size limits.
  outputFileTracingExcludes: {
    "/api/step": [
      "./node_modules/stockfish/bin/stockfish-19.*",
      "./node_modules/stockfish/bin/stockfish-19-single.*",
      "./node_modules/stockfish/bin/stockfish-19-lite.*",
      "./node_modules/stockfish/bin/stockfish-19-asm.js",
    ],
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
