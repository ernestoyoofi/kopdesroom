import htmlMinifier from "vite-plugin-html-minifier";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    htmlMinifier({
      minify: true,
    }),
  ],
})