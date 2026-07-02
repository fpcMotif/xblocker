import { defineConfig } from "wxt";

export default defineConfig({
  manifest: {
    name: "X Blocker",
    description: "Analyzes and filters content on X.com based on configured topics",
    version: "1.0.0",
    permissions: ["storage", "alarms"],
    host_permissions: [
      "https://x.com/*",
      "https://api.x.com/*",
      "https://api.twitter.com/*",
      "https://*.convex.cloud/*",
    ],
  },
});
