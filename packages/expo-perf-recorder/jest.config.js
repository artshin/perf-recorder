// Pure JS/TS capture-layer tests. They exercise the operations-stream decoder
// and the capture loop — no React rendering, no native module — so we run them
// in a plain node environment via ts-jest, NOT the jest-expo RN preset.
//
// Why not jest-expo: its preset pulls in react-native's own jest-preset, and the
// hoisted react-native (0.85) moved that preset out to a separate package, so
// jest-expo 53 can't load it here. These tests need none of it.
//
// isolatedModules = transpile-only: type-checking lives in `yarn typecheck`
// (expo-module build), so tests stay fast and independent of the ts-jest <-> TS
// version peer range.
module.exports = {
  testEnvironment: "node",
  testMatch: ["**/__tests__/**/*.test.ts"],
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        isolatedModules: true,
        // ts-jest emits CommonJS for node; override the inherited
        // bundler-resolution tsconfig so module/moduleResolution agree.
        tsconfig: {
          module: "commonjs",
          moduleResolution: "node",
          esModuleInterop: true,
        },
      },
    ],
  },
};
