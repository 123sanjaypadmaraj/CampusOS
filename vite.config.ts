import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// CampusOS is mid-migration from JavaScript to TypeScript (doc §4): new and
// rewritten files use .ts/.tsx, legacy files stay .jsx/.js. Any file that
// contains JSX must use a .jsx/.tsx extension (esbuild picks its parser
// from the extension) -- see docs/ROADMAP.md for the incremental-adoption
// convention.
export default defineConfig({
  plugins: [react()],
  envPrefix: "VITE_",
  server: {
    port: 5173,
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
