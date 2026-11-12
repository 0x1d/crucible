import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";
import globals from "globals";

export default defineConfig([
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // A leading underscore marks a parameter kept for the signature.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    // Its callbacks run in the browser page (page.waitForFunction, page.evaluate).
    files: ["scripts/walkthrough.mjs"],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
  globalIgnores(["dist/**", "node_modules/**", ".nsh/**"]),
  {
    files: ["host.js"],
    languageOptions: { globals: globals.browser },
  },
]);
