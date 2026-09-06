# Offline .crx builds

`bun run crx` turns the local build into a single signed file you can copy to another
machine and install without the Chrome Web Store.

```bash
bun run crx                 # build + zip + sign
bun run crx -- --skip-build # sign what is already in .output/
```

It writes three things:

| Path | What it is |
| --- | --- |
| `.output/xblocker-<version>-chrome.crx` | the signed extension (CRX3) |
| `.output/update.xml` | an update manifest pointing at that `.crx` — only needed for the policy install below |
| `.keys/crx.pem` | the signing key, created on first run (gitignored) |

## The key is the extension's identity

Chrome derives the extension ID from the signing key's public half, so the same key always
produces the same ID — and installing a new build over an old one keeps its
`chrome.storage` data (settings, whitelist, blocked log). Lose the key and the next build
is a different extension with an empty profile, so back `.keys/crx.pem` up somewhere safe.
Point `XBLOCKER_CRX_KEY` at another path to use a different key.

The build also pins that key's public half into `manifest.json` as `key` whenever the file
is present, so a `Load unpacked` build and the packed `.crx` share one ID instead of
Chrome inventing one from the load path.

## Installing it

**Unpacked (always works).** `chrome://extensions/` → Developer mode → *Load unpacked* →
`.output/chrome-mv3`. The `.crx` isn't involved; the ID still comes from the pinned key.

**Drag the `.crx` onto `chrome://extensions/`.** Worth trying, but off-store `.crx` files
are blocked outright on Windows and can be rejected elsewhere with
`CRX_REQUIRED_PROOF_MISSING` — that error means Chrome wanted a Web Store publisher
signature, which only the Web Store can produce. Fall back to one of the other routes.

**Launch flag.** `--load-extension=/absolute/path/.output/chrome-mv3` on a Chrome you
start yourself, useful for a throwaway profile:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --user-data-dir=/tmp/xb --load-extension="$PWD/.output/chrome-mv3"
```

**Enterprise policy (the supported off-store install).** Allow this specific ID and hand
Chrome the update manifest. On macOS that is a managed-preferences plist, which needs
`sudo` — replace the ID with the one `bun run crx` printed:

```bash
sudo defaults write /Library/Managed\ Preferences/com.google.Chrome ExtensionSettings -dict-add fpdfmflmghknmafmhcgagfjaodbpicpl '{"installation_mode":"normal_installed","update_url":"file:///Users/you/devv/xblocker/.output/update.xml"}'
```

Restart Chrome and check `chrome://policy`. If Chrome ignores the `file://` update URL,
serve the folder over `http://localhost` and use that URL in both the policy and
`update.xml`'s `codebase`.

## How the container is checked

`packages/crx/tests/pack.test.ts` decodes the produced bytes with its own protobuf reader
and verifies the signature, rather than trusting the packer's encoders to agree with
themselves. Beyond that, the output was compared once against Chrome's own packer —
`chrome --pack-extension` on the same build with the same key — and matches it field for
field: same header fields, same public key, same signed header, same extension ID, and
Chrome's signature verifies under the same signed-payload construction.
