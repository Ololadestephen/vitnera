import { hashCanonical, verifyCiphertextHash } from "@vitnera/core";
import { appConfig } from "./config";

type UploadResponse = { cid: string; uri: string; gatewayUrl: string; size: number };

export async function uploadEncryptedBlob(
  bytes: Uint8Array,
  name: string,
  contentHash: string,
  mimeType = "application/octet-stream",
): Promise<UploadResponse> {
  const form = new FormData();
  form.append("file", new Blob([bytes.slice().buffer], { type: mimeType }), name);
  form.append("name", name);
  form.append("contentHash", contentHash);
  const response = await fetch(`${appConfig.storageApi}/api/upload/ipfs`, { method: "POST", body: form });
  const body = (await response.json().catch(() => ({}))) as Partial<UploadResponse> & { error?: string };
  if (!response.ok || !body.uri) throw new Error(body.error ?? "Encrypted IPFS upload failed");
  return body as UploadResponse;
}

export async function uploadJson(value: unknown, name: string): Promise<UploadResponse> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return uploadEncryptedBlob(bytes, name, await hashCanonical(value), "application/json");
}

export function gatewayUrl(uri: string): string {
  if (uri.startsWith("ipfs://")) return `https://gateway.pinata.cloud/ipfs/${uri.slice(7)}`;
  return uri;
}

export async function fetchJson<T>(uri: string): Promise<T> {
  const response = await fetch(gatewayUrl(uri));
  if (!response.ok) throw new Error(`IPFS fetch failed (${response.status})`);
  return response.json() as Promise<T>;
}

export async function fetchVerifiedBytes(uri: string, hash: string): Promise<Uint8Array> {
  const response = await fetch(gatewayUrl(uri));
  if (!response.ok) throw new Error(`IPFS fetch failed (${response.status})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!(await verifyCiphertextHash(bytes, hash))) throw new Error("IPFS ciphertext failed its integrity check");
  return bytes;
}
