import stylex from "@stylexjs/unplugin/vite";
import { defineConfig } from "wxt";

const HTML_ENTRYPOINT_TYPES: Record<string, true> = {
  popup: true,
  options: true,
  "unlisted-page": true,
};

export default defineConfig({
  hooks: {
    "vite:build:extendConfig"(entrypoints, viteConfig) {
      if (entrypoints.some((e) => HTML_ENTRYPOINT_TYPES[e.type])) {
        viteConfig.plugins = viteConfig.plugins ?? [];
        viteConfig.plugins.push(
          stylex({
            useCSSLayers: true,
            unstable_moduleResolution: {
              type: "commonJS",
              rootDir: process.cwd(),
            },
          }),
        );
      }
    },
    "vite:devServer:extendConfig"(viteConfig) {
      viteConfig.plugins = viteConfig.plugins ?? [];
      viteConfig.plugins.push(
        stylex({
          useCSSLayers: true,
          unstable_moduleResolution: {
            type: "commonJS",
            rootDir: process.cwd(),
          },
        }),
      );
    },
  },
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
