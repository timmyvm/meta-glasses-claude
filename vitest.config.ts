import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The Expo app in mobile/ has its own toolchain.
    exclude: ["**/node_modules/**", "mobile/**"],
  },
});
