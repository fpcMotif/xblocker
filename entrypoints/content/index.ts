import { defineContentScript } from "wxt/utils/define-content-script";
import { ContentSession } from "./content-session";

export default defineContentScript({
  matches: ["https://x.com/*"],
  main() {
    new ContentSession().start();
  },
});
