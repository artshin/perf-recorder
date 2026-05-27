// Flat ESLint config for @artshin/rozenite-perf-recorder (ESM package).
// The publishable surface is a DevTools web panel plus a React Native hook;
// eslint-config-universe's `web` preset gives React + hooks + TS + import
// rules without the RN-specific style rules that would fire on the panel.
import { defineConfig } from "eslint/config";
import universe from "eslint-config-universe/flat/web.js";

export default defineConfig([
  ...universe,
  {
    ignores: ["dist/**"],
  },
  {
    rules: {
      // `void promise()` in statement position is our intentional
      // fire-and-forget marker for the polling side effects.
      "no-void": ["warn", { allowAsStatement: true }],
    },
  },
]);
