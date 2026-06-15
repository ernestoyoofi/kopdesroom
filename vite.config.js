import htmlMinifier from "vite-plugin-html-minifier";
import { dirname, resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rolldownOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        download: resolve(import.meta.dirname, "download.html"),
      },
    },
  },
  plugins: [
    htmlMinifier({
      minify: true,
    }),
  ],
})