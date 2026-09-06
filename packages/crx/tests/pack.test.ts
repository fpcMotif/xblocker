// Catalog: CRX-* (packages/crx/pack: key generation, extension identity, and the CRX3
// container). The container is checked by decoding the produced bytes here rather than by
// reusing the packer's own encoders, so a wrong tag or a wrong signature payload shows up
// as a failure instead of cancelling itself out.
import { createHash, createVerify } from "node:crypto";
import { describe, expect, test } from "bun:test";

import { crxIdentity, generateCrxKey, packCrx } from "../pack.ts";

const KEY = generateCrxKey();
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5]);

/** Minimal protobuf reader: every field CRX3 uses is length-delimited. */
function readFields(bytes: Buffer): Map<number, Buffer> {
  const fields = new Map<number, Buffer>();
  let offset = 0;
  const varint = () => {
    let value = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = bytes[offset++]!;
      value += (byte & 0x7f) * 2 ** shift;
      shift += 7;
    } while (byte & 0x80);

    return value;
  };
  while (offset < bytes.length) {
    const fieldNumber = varint() >> 3;
    const length = varint();
    fields.set(fieldNumber, bytes.subarray(offset, offset + length));
    offset += length;
  }

  return fields;
}

function parse(crx: Uint8Array) {
  const buffer = Buffer.from(crx);
  const headerSize = buffer.readUInt32LE(8);
  const header = readFields(buffer.subarray(12, 12 + headerSize));
  const proof = readFields(header.get(2)!);

  return {
    magic: buffer.subarray(0, 4).toString(),
    version: buffer.readUInt32LE(4),
    signedHeader: header.get(10_000)!,
    publicKey: proof.get(1)!,
    signature: proof.get(2)!,
    archive: buffer.subarray(12 + headerSize),
  };
}

describe("crx identity", () => {
  test("CRX-01 a generated key is a PKCS#8 PEM, and each key is its own identity", () => {
    expect(KEY.startsWith("-----BEGIN PRIVATE KEY-----")).toBe(true);
    expect(crxIdentity(KEY).extensionId).not.toBe(crxIdentity(generateCrxKey()).extensionId);
  });

  test("CRX-02 the ID is the first half of SHA-256 over the public key, nibbles mapped a-p", () => {
    const { extensionId, publicKeyBase64 } = crxIdentity(KEY);
    const digest = createHash("sha256").update(Buffer.from(publicKeyBase64, "base64")).digest();
    const expected = digest
      .subarray(0, 16)
      .toString("hex")
      .replaceAll(/[\da-f]/g, (nibble) => String.fromCharCode(97 + Number.parseInt(nibble, 16)));

    expect(extensionId).toBe(expected);
    expect(extensionId).toMatch(/^[a-p]{32}$/);
  });

  test("CRX-03 the same key always yields the same identity", () => {
    expect(crxIdentity(KEY)).toEqual(crxIdentity(KEY));
  });
});

describe("packCrx", () => {
  test("CRX-04 the container is CRX3 with the archive appended verbatim", () => {
    const { magic, version, archive } = parse(packCrx(ZIP, KEY).crx);

    expect(magic).toBe("Cr24");
    expect(version).toBe(3);
    expect(Uint8Array.from(archive)).toEqual(ZIP);
  });

  test("CRX-05 the header carries the key, the crx_id, and a signature over the CRX3 payload", () => {
    const packed = packCrx(ZIP, KEY);
    const { signedHeader, publicKey, signature } = parse(packed.crx);
    const crxId = readFields(signedHeader).get(1)!;

    expect(publicKey.toString("base64")).toBe(packed.publicKeyBase64);
    expect(crxId).toEqual(createHash("sha256").update(publicKey).digest().subarray(0, 16));

    const length = Buffer.alloc(4);
    length.writeUInt32LE(signedHeader.length);
    const verified = createVerify("sha256")
      .update(
        Buffer.concat([Buffer.from("CRX3 SignedData\0"), length, signedHeader, Buffer.from(ZIP)]),
      )
      .verify(
        `-----BEGIN PUBLIC KEY-----\n${packed.publicKeyBase64}\n-----END PUBLIC KEY-----\n`,
        signature,
      );

    expect(verified).toBe(true);
  });

  test("CRX-06 packing reports the same identity the key resolves to", () => {
    const packed = packCrx(ZIP, KEY);

    expect(packed.extensionId).toBe(crxIdentity(KEY).extensionId);
    expect(packed.publicKeyBase64).toBe(crxIdentity(KEY).publicKeyBase64);
  });
});
