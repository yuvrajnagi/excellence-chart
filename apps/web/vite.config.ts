import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: Number(process.env["WEB_PORT"] ?? 5173),
    strictPort: true,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${process.env["PORT"] ?? 3001}`,
        changeOrigin: false,
        configure(proxy) {
          proxy.on("proxyReq", (outgoing, incoming) => {
            // Preserve the server's origin check through the trusted local dev proxy.
            const origin = incoming.headers.origin;
            if (origin) {
              try {
                if (new URL(origin).host === incoming.headers.host) {
                  outgoing.setHeader("origin", `http://127.0.0.1:${process.env["PORT"] ?? 3001}`);
                  outgoing.setHeader("host", `127.0.0.1:${process.env["PORT"] ?? 3001}`);
                }
              } catch { /* Invalid origins are rejected by the API. */ }
            }
          });
        },
      },
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
  worker: { format: "es" },
});
