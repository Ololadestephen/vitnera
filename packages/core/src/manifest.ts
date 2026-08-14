import { canonicalJson } from "./canonical.js";
import { concatBytes, hexToBytes, utf8 } from "./encoding.js";
import { sha256Bytes, sha256Hex } from "./hash.js";
import { solarManifestSchema, type SolarManifest } from "./schemas.js";

export async function manifestHash(manifest: SolarManifest): Promise<`0x${string}`> {
  return sha256Hex(utf8(canonicalJson(solarManifestSchema.parse(manifest))));
}

export async function documentMerkleRoot(manifest: SolarManifest): Promise<`0x${string}`> {
  const parsed = solarManifestSchema.parse(manifest);
  let level = await Promise.all(
    parsed.documents.map((document) => sha256Bytes(utf8(canonicalJson(document)))),
  );
  while (level.length > 1) {
    const next: Uint8Array[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index];
      const right = level[index + 1] ?? left;
      next.push(await sha256Bytes(concatBytes(left, right)));
    }
    level = next;
  }
  return sha256Hex(level[0]);
}

export async function verifyCiphertextHash(
  ciphertext: Uint8Array,
  expectedHash: string,
): Promise<boolean> {
  const actual = await sha256Bytes(ciphertext);
  const expected = hexToBytes(expectedHash);
  if (actual.length !== expected.length) return false;
  return actual.every((byte, index) => byte === expected[index]);
}
