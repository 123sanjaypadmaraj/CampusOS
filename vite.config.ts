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
    rollupOptions: {
      output: {
        // Split third-party deps out of the app bundle into their own
        // vendor chunks: they change far less often than app code, so this
        // lets the browser cache them across CampusOS deploys instead of
        // re-downloading React/Supabase/etc. on every release.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("react-dom") || /[\\/]react[\\/]/.test(id) || id.includes("scheduler")) {
            return "vendor-react";
          }
          if (id.includes("@supabase")) return "vendor-supabase";
          if (id.includes("@tanstack")) return "vendor-query";
          if (id.includes("react-icons")) return "vendor-icons";
          return "vendor";
        },
      },
    },
  },
});
