import { resolve } from "path";
import { defineConfig } from "@spicetify/creator";

// Learn more: https://github.com/sanoojes/spicetify-creator
export default defineConfig({
  name: "playlists-manager-app",
  framework: "react",
  linter: "biome",
  template: "custom-app",
  packageManager: "bun",
  esbuildOptions: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
});
