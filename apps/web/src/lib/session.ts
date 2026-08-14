import { base64ToBytes, bytesToBase64, type InvestorKeyPair } from "@vitnera/core";

const prefix = "vitnera:rwa:v1";
const legacyPrefix = "aegiskey:rwa:v1";

export function saveRoomKey(wallet: string, roomId: string, version: number, key: Uint8Array): void {
  sessionStorage.setItem(`${prefix}:room:${wallet.toLowerCase()}:${roomId}:${version}`, bytesToBase64(key));
}

export function loadRoomKey(wallet: string, roomId: string, version: number): Uint8Array | null {
  const suffix = `room:${wallet.toLowerCase()}:${roomId}:${version}`;
  const value = sessionStorage.getItem(`${prefix}:${suffix}`) ?? sessionStorage.getItem(`${legacyPrefix}:${suffix}`);
  return value ? base64ToBytes(value) : null;
}

export function saveInvestorKey(wallet: string, roomId: string, version: number, pair: InvestorKeyPair): void {
  sessionStorage.setItem(
    `${prefix}:investor:${wallet.toLowerCase()}:${roomId}:${version}`,
    JSON.stringify({ privateKey: bytesToBase64(pair.privateKey), publicKey: bytesToBase64(pair.publicKey) }),
  );
}

export function loadInvestorKey(wallet: string, roomId: string, version: number): InvestorKeyPair | null {
  const suffix = `investor:${wallet.toLowerCase()}:${roomId}:${version}`;
  const value = sessionStorage.getItem(`${prefix}:${suffix}`) ?? sessionStorage.getItem(`${legacyPrefix}:${suffix}`);
  if (!value) return null;
  const parsed = JSON.parse(value) as { privateKey: string; publicKey: string };
  return { privateKey: base64ToBytes(parsed.privateKey), publicKey: base64ToBytes(parsed.publicKey) };
}

export function downloadJson(value: unknown, filename: string): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function downloadBytes(bytes: Uint8Array, filename: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
