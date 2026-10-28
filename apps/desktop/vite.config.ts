import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  plugins: [{
    name: "tauri-local-assets",
    transformIndexHtml(html) {
      return html.replaceAll(" crossorigin", "");
    },
  }],
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  build: { outDir: "dist", emptyOutDir: true },
});
