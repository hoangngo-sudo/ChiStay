import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rolldownOptions: {
      output: {
        minify: { mangle: false },
      },
    },
  },
});