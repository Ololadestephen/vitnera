import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, "../..", "");
  const storageApi = env.VITE_STORAGE_API_URL || "http://localhost:8787";

  return {
    plugins: [react()],
    envDir: "../..",
    server: {
      port: 5174,
      proxy: {
        "/storage-api": {
          target: storageApi,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/storage-api/u, ""),
        },
      },
    },
    build: { target: "es2022" },
  };
});
