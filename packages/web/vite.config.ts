import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === "build" ? "/LatticeWard-protocol/" : "/",
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api/qore-rest": {
        target: "https://api-testnet.qore.host",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/qore-rest/, ""),
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
}));
