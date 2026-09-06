import { existsSync, readFileSync } from "node:fs";
import { defineConfig } from "wxt";

import { crxIdentity } from "./packages/crx/pack.ts";

// When the .crx signing key exists locally, pin its public key into the manifest so an
// unpacked build and a packed .crx share one extension ID — and therefore one
// chrome.storage profile. Without the key the build still works, it just gets whatever ID
// Chrome derives from the load path. See scripts/pack-crx.ts.
const keyPath = process.env.XBLOCKER_CRX_KEY ?? ".keys/crx.pem";
const crxKey = existsSync(keyPath)
  ? { key: crxIdentity(readFileSync(keyPath, "utf8")).publicKeyBase64 }
  : {};

export default defineConfig({
  manifest: {
    ...crxKey,
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
