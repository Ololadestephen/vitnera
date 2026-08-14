import { canonicalJson } from "./canonical.js";
import { asBuffer, bytesToHex, utf8 } from "./encoding.js";

export async function sha256Bytes(value: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", asBuffer(value)));
}

export async function sha256Hex(value: Uint8Array): Promise<`0x${string}`> {
  return bytesToHex(await sha256Bytes(value));
}

export async function hashCanonical(value: unknown): Promise<`0x${string}`> {
  return sha256Hex(utf8(canonicalJson(value)));
}
