import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import { fileURLToPath } from "node:url";
import path from "node:path";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

// SPA only — no SSR. This is a pure client-side WebGL + File System Access app.
export default defineConfig({
  plugins: [
    TanStackRouterVite({ target: "react" }),
    react(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "./src"),
    },
  },
  build: {
    // Three.js is inherently ~600 kB; split vendors into their own cached chunks.
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ["three"],
          react: ["react", "react-dom"],
        },
      },
    },
  },
});
