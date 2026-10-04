import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import cesium from "vite-plugin-cesium";

// Root package serves ./client as the web root. Server (tsx, :2567) owns /api + WS.
export default defineConfig({
  root: "client",
  plugins: [react(), cesium()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:2567",
      "/colyseus": "http://localhost:2567",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
