import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "src/renderer",
  base: "./", // packaged app loads dist/index.html via file://
  plugins: [react()],
  build: {
    outDir: "../../dist",
    emptyOutDir: true,
    target: "es2020",
  },
  test: {
    root: ".",
    include: ["src/**/*.test.ts"],
  },
});
