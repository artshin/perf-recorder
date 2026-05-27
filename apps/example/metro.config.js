// Metro config for the example app inside the Yarn workspace.
//
// Two concerns:
//   1. Monorepo resolution — watch the workspace root and resolve the hoisted
//      node_modules so the local @artshin/* packages and the single hoisted
//      react / react-native copy resolve correctly.
//   2. Rozenite (optional) — withRozenite auto-discovers installed Rozenite
//      plugins (here @artshin/rozenite-perf-recorder) and serves their DevTools
//      panels + agent tools. Gated on WITH_ROZENITE so a plain `expo start`
//      stays lean; use `yarn start:rozenite` to enable the panel.
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

if (process.env.WITH_ROZENITE) {
  const { withRozenite } = require("@rozenite/metro");
  module.exports = withRozenite(config);
} else {
  module.exports = config;
}
