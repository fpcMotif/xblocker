import { defineConfig } from "@playwright/test";

// Real-Chromium design checks for the built extension. Run with `bun run design`.
// Specs are named *.pw.ts so `bun test` never picks them up.
export default defineConfig({
  testDir: ".",
  testMatch: "*.pw.ts",
  outputDir: "./results",
  snapshotPathTemplate: "{testDir}/baselines/{arg}{ext}",
  fullyParallel: true,
  workers: 4,
  reporter: [["list"]],
  expect: {
    toHaveScreenshot: { animations: "disabled", maxDiffPixelRatio: 0.002 },
  },
});
