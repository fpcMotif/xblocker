import { defineConfig } from "wxt";

export default defineConfig({
  manifest: {
    name: "X Blocker",
    description: "Block, mute, or whitelist X.com reply authors from an in-page action bar",
    version: "1.0.0",
    permissions: ["storage"],
    host_permissions: ["https://x.com/*", "https://api.x.com/*"],
  },
});
