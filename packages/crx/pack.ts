// Entry point: sign a built extension ZIP into an installable, offline .crx (CRX3).
//
// The signing key is the extension's identity — Chrome derives the extension ID from the
// public key, so the same key always yields the same ID, and an install over a previous
// one keeps its chrome.storage data. Keep the private key out of the repo; regenerating
// it means a new ID and a fresh, empty profile for the extension.

import { createPrivateKey, createPublicKey, createSign, generateKeyPairSync } from "node:crypto";

import {
  container,
  crxId,
  crxIdString,
  fileHeader,
  signaturePayload,
  signedHeaderData,
} from "./lib/crx3";

export interface CrxIdentity {
  /** The 32-char extension ID Chrome shows on chrome://extensions. */
  extensionId: string;
  /** SPKI public key, base64 — the value manifest.json's `key` field takes. */
  publicKeyBase64: string;
}

export interface PackedCrx extends CrxIdentity {
  crx: Uint8Array;
}

/** A fresh 2048-bit RSA signing key, PKCS#8 PEM — the format Chrome's own packer emits. */
export function generateCrxKey(): string {
  return generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  }).privateKey;
}

/** The extension ID and manifest `key` a given private key produces. */
export function crxIdentity(privateKeyPem: string): CrxIdentity {
  const publicKeyDer = publicKeyOf(privateKeyPem);

  return {
    extensionId: crxIdString(crxId(publicKeyDer)),
    publicKeyBase64: publicKeyDer.toString("base64"),
  };
}

/** Wrap a built extension ZIP into a signed CRX3 file. */
export function packCrx(zip: Uint8Array, privateKeyPem: string): PackedCrx {
  const publicKeyDer = publicKeyOf(privateKeyPem);
  const signedHeader = signedHeaderData(crxId(publicKeyDer));
  const signature = createSign("sha256")
    .update(signaturePayload(signedHeader, zip))
    .sign(createPrivateKey(privateKeyPem));

  return {
    crx: container(fileHeader(publicKeyDer, signature, signedHeader), zip),
    ...crxIdentity(privateKeyPem),
  };
}

function publicKeyOf(privateKeyPem: string): Buffer {
  return createPublicKey(privateKeyPem).export({ type: "spki", format: "der" });
}
