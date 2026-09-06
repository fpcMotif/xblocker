// The CRX3 container format, byte for byte. A .crx file is:
//
//   "Cr24" | uint32le version (3) | uint32le header size | CrxFileHeader | ZIP archive
//
// CrxFileHeader is protobuf, so this file carries the two wire pieces we need — varints
// and length-delimited fields — instead of pulling in a protobuf runtime for three
// message types (crx3.proto: CrxFileHeader, AsymmetricKeyProof, SignedData).

import { createHash } from "node:crypto";

/** Protobuf base-128 varint. */
function varint(value: number): Buffer {
  const bytes: number[] = [];
  let rest = value;
  while (rest > 0x7f) {
    bytes.push((rest & 0x7f) | 0x80);
    rest >>>= 7;
  }
  bytes.push(rest);

  return Buffer.from(bytes);
}

/** A protobuf length-delimited (wire type 2) field: `<tag><length><payload>`. */
export function field(fieldNumber: number, payload: Uint8Array): Buffer {
  return Buffer.concat([varint(fieldNumber * 8 + 2), varint(payload.length), payload]);
}

/** SignedData { bytes crx_id = 1 } — the 16 raw ID bytes, wrapped. */
export function signedHeaderData(id: Uint8Array): Buffer {
  return field(1, id);
}

/**
 * CrxFileHeader { repeated AsymmetricKeyProof sha256_with_rsa = 2; bytes signed_header_data = 10000 }
 * with a single proof — one signer, RSA.
 */
export function fileHeader(
  publicKeyDer: Uint8Array,
  signature: Uint8Array,
  signedHeader: Uint8Array,
): Buffer {
  const proof = Buffer.concat([field(1, publicKeyDer), field(2, signature)]);

  return Buffer.concat([field(2, proof), field(10_000, signedHeader)]);
}

/** The raw 16-byte extension ID: the first half of SHA-256 over the SPKI public key. */
export function crxId(publicKeyDer: Uint8Array): Buffer {
  return createHash("sha256").update(publicKeyDer).digest().subarray(0, 16);
}

/** The 32-char `mppc…`-style ID Chrome shows: each ID nibble mapped 0-f onto a-p. */
export function crxIdString(crxIdBytes: Uint8Array): string {
  return [...crxIdBytes]
    .flatMap((byte) => [byte >> 4, byte & 0x0f])
    .map((nibble) => String.fromCharCode(97 + nibble))
    .join("");
}

/**
 * The bytes a CRX3 signature covers: a format-pinning prefix, the length-prefixed
 * signed header, then the archive itself — so a signature can't be replayed onto a
 * different archive or a different header.
 */
export function signaturePayload(signedHeader: Uint8Array, zip: Uint8Array): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32LE(signedHeader.length);

  return Buffer.concat([
    Buffer.from("CRX3 SignedData"),
    Buffer.from([0]),
    length,
    signedHeader,
    zip,
  ]);
}

/** The final container: magic, version, header size, header, archive. */
export function container(header: Uint8Array, zip: Uint8Array): Buffer {
  const prefix = Buffer.alloc(12);
  prefix.write("Cr24", 0);
  prefix.writeUInt32LE(3, 4);
  prefix.writeUInt32LE(header.length, 8);

  return Buffer.concat([prefix, header, zip]);
}
