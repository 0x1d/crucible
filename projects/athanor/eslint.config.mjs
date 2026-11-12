import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";
import globals from "globals";

export default defineConfig([
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: globals.node,
    },
  },
  globalIgnores(["dist/**", "node_modules/**", ".nsh/**"]),
  {
    files: ["host.js"],
    languageOptions: { globals: globals.browser },
  },
]);
