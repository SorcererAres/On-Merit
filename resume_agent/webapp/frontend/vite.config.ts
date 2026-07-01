import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// dev：base '/'，代理 /api → 后端 8000；build：base '/static/'，产物进 ../static
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/static/" : "/",
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  server: { proxy: { "/api": "http://127.0.0.1:8000" } },
  build: { outDir: "../static", emptyOutDir: true },
}));
