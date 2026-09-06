// Build the extension and sign the result into an offline .crx, next to an update.xml
// that points at it. Usage:
//
//   bun run crx                 # build, zip, sign
//   bun run crx -- --skip-build # sign whatever is already in .output/
//
// The signing key lives at .keys/crx.pem (override with XBLOCKER_CRX_KEY) and is created
// on first run. It is the extension's identity — back it up, and never commit it.

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";

import { generateCrxKey, packCrx } from "../packages/crx/pack.ts";

const OUT_DIR = resolve(".output");
const KEY_PATH = resolve(process.env.XBLOCKER_CRX_KEY ?? ".keys/crx.pem");

function readKey(): string {
  if (existsSync(KEY_PATH)) {
    return readFileSync(KEY_PATH, "utf8");
  }

  mkdirSync(resolve(KEY_PATH, ".."), { recursive: true });
  const pem = generateCrxKey();
  writeFileSync(KEY_PATH, pem, { mode: 0o600 });
  chmodSync(KEY_PATH, 0o600);
  console.log(`Generated a new signing key at ${KEY_PATH} — back it up, never commit it.`);

  return pem;
}

function build(): void {
  const zip = Bun.spawnSync(["bun", "run", "zip"], { stdio: ["inherit", "inherit", "inherit"] });
  if (zip.exitCode !== 0) {
    throw new Error("`bun run zip` failed — fix the build before packing a .crx.");
  }
}

function newestZip(): string {
  const zips = readdirSync(OUT_DIR)
    .filter((name) => name.endsWith("-chrome.zip"))
    .map((name) => join(OUT_DIR, name))
    .toSorted((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  const newest = zips[0];
  if (!newest) {
    throw new Error(`No *-chrome.zip in ${OUT_DIR} — run without --skip-build.`);
  }

  return newest;
}

/** The version the build actually stamped into manifest.json — update.xml must match it. */
function builtVersion(): string {
  const manifest: unknown = JSON.parse(
    readFileSync(join(OUT_DIR, "chrome-mv3", "manifest.json"), "utf8"),
  );
  if (!(manifest instanceof Object) || !("version" in manifest)) {
    throw new Error(`No version in ${OUT_DIR}/chrome-mv3/manifest.json.`);
  }

  return String(manifest.version);
}

function updateManifest(extensionId: string, version: string, crxPath: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">
  <app appid="${extensionId}">
    <updatecheck codebase="file://${crxPath}" version="${version}" />
  </app>
</gupdate>
`;
}

// The key first: the build reads it back to pin `key` into the manifest (see wxt.config.ts).
const privateKeyPem = readKey();
if (!process.argv.includes("--skip-build")) {
  build();
}

const zipPath = newestZip();
const crxPath = zipPath.replace(/\.zip$/, ".crx");
const packed = packCrx(readFileSync(zipPath), privateKeyPem);
writeFileSync(crxPath, packed.crx);
const xmlPath = join(OUT_DIR, "update.xml");
writeFileSync(xmlPath, updateManifest(packed.extensionId, builtVersion(), crxPath));

console.log(`
Packed ${basename(crxPath)} (${(packed.crx.length / 1024).toFixed(1)} KB)
  crx          ${crxPath}
  update.xml   ${xmlPath}
  extension ID ${packed.extensionId}
  signing key  ${KEY_PATH}

Dragging an off-store .crx onto chrome://extensions is blocked on Windows and can fail
elsewhere with CRX_REQUIRED_PROOF_MISSING. The routes that always work: load
.output/chrome-mv3 unpacked, or allow the ID above by enterprise policy pointing at
${basename(xmlPath)}. See docs/offline-crx.md.
`);
