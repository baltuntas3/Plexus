import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("@monaco-editor")) return "monaco";
          if (id.includes("recharts")) return "charts";
          if (id.includes("@xyflow") || id.includes("@dagrejs")) return "graph";
          if (id.includes("@mantine")) return "mantine";
          if (id.includes("react-router-dom")) return "router";
          if (id.includes("jotai")) return "state";
          return "vendor";
        },
      },
    },
  },
});
