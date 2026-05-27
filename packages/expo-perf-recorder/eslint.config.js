// Flat ESLint config for @artshin/expo-perf-recorder.
// expo-module-scripts runs `eslint src`; ESLint 9+ requires this flat config.
// eslint-config-universe ships flat presets (peer: eslint >=8.10); `native` is
// the React Native preset.
const { defineConfig } = require("eslint/config");
const universe = require("eslint-config-universe/flat/native");

module.exports = defineConfig([
  ...universe,
  {
    ignores: ["build/**"],
  },
  {
    rules: {
      // `void promise()` in statement position is our intentional
      // fire-and-forget marker for dev-only side effects.
      "no-void": ["warn", { allowAsStatement: true }],
    },
  },
]);
