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
    // WXT auto-discovers public/icon/{size}.png into manifest.icons, but the toolbar
    // button (action.default_icon) has no such auto-detection, so it's set explicitly.
    action: {
      default_icon: {
        "16": "icon/16.png",
        "32": "icon/32.png",
        "48": "icon/48.png",
        "128": "icon/128.png",
      },
    },
  },
});
