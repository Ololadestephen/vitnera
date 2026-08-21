import { x25519 } from "@noble/curves/ed25519";
import { canonicalJson } from "./canonical.js";
import {
  asBuffer,
  base64ToBytes,
  bytesToBase64,
  bytesToHex,
  concatBytes,
  decodeUtf8,
  utf8,
} from "./encoding.js";
import { sha256Bytes, sha256Hex } from "./hash.js";

const AES_KEY_BYTES = 32;
const AES_IV_BYTES = 12;
const RECOVERY_ITERATIONS = 600_000;

export type RoomKey = {
  bytes: Uint8Array;
  commitment: `0x${string}`;
};

export type EncryptedDocument = {
  ciphertext: Uint8Array;
  ciphertextHash: `0x${string}`;
  iv: string;
  associatedData: string;
};

export type InvestorKeyPair = {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
};

export type CreatorRecoveryIdentity = InvestorKeyPair;

export type CreatorRecoveryExport = {
  format: "vitnera-creator-recovery-v1";
  wallet: string;
  publicKey: string;
  salt: string;
  iv: string;
  ciphertext: string;
  iterations: number;
  createdAt: string;
};

export type CreatorRoomKeyEnvelope = {
  format: "vitnera-creator-room-key-envelope-v1";
  assetId: string;
  roomVersion: number;
  keyCommitment: string;
  recoveryPublicKey: string;
  ephemeralPublicKey: string;
  iv: string;
  ciphertext: string;
  associatedData: string;
};

export type KeyEnvelope = {
  format: "vitnera-key-envelope-v1" | "aegiskey-key-envelope-v1";
  roomId: string;
  roomVersion: number;
  investor: string;
  metadataUri?: string;
  ephemeralPublicKey: string;
  iv: string;
  ciphertext: string;
  associatedData: string;
};

export type RecoveryExport = {
  format: "vitnera-recovery-v1" | "aegiskey-recovery-v1";
  wallet: string;
  publicKey: string;
  salt: string;
  iv: string;
  ciphertext: string;
  iterations: number;
  createdAt: string;
};

export type RoomKeyRecoveryExport = {
  format: "vitnera-room-key-recovery-v1" | "aegiskey-room-key-recovery-v1";
  roomId: string;
  roomVersion: number;
  keyCommitment: `0x${string}`;
  salt: string;
  iv: string;
  ciphertext: string;
  iterations: number;
  createdAt: string;
};

export async function generateRoomKey(): Promise<RoomKey> {
  const bytes = crypto.getRandomValues(new Uint8Array(AES_KEY_BYTES));
  return { bytes, commitment: await sha256Hex(bytes) };
}

export async function encryptDocument(input: {
  plaintext: Uint8Array;
  roomKey: Uint8Array;
  roomId: string;
  roomVersion: number;
  documentId: string;
  mimeType: string;
}): Promise<EncryptedDocument> {
  assertLength(input.roomKey, AES_KEY_BYTES, "Room key");
  const associatedData = canonicalJson({
    protocol: "vitnera-rwa-v1",
    roomId: input.roomId,
    roomVersion: input.roomVersion,
    documentId: input.documentId,
    mimeType: input.mimeType,
  });
  const iv = crypto.getRandomValues(new Uint8Array(AES_IV_BYTES));
  const key = await crypto.subtle.importKey("raw", asBuffer(input.roomKey), "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: asBuffer(iv), additionalData: asBuffer(utf8(associatedData)) },
      key,
      asBuffer(input.plaintext),
    ),
  );
  return {
    ciphertext,
    ciphertextHash: await sha256Hex(ciphertext),
    iv: bytesToBase64(iv),
    associatedData,
  };
}

export async function decryptDocument(input: {
  ciphertext: Uint8Array;
  roomKey: Uint8Array;
  iv: string;
  associatedData: string;
}): Promise<Uint8Array> {
  assertLength(input.roomKey, AES_KEY_BYTES, "Room key");
  const key = await crypto.subtle.importKey("raw", asBuffer(input.roomKey), "AES-GCM", false, ["decrypt"]);
  return new Uint8Array(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: asBuffer(base64ToBytes(input.iv)),
        additionalData: asBuffer(utf8(input.associatedData)),
      },
      key,
      asBuffer(input.ciphertext),
    ),
  );
}

export function generateInvestorKeyPair(): InvestorKeyPair {
  const privateKey = x25519.utils.randomPrivateKey();
  return { privateKey, publicKey: x25519.getPublicKey(privateKey) };
}

export function generateCreatorRecoveryIdentity(): CreatorRecoveryIdentity {
  return generateInvestorKeyPair();
}

export async function createCreatorRoomKeyEnvelope(input: {
  roomKey: Uint8Array;
  recoveryPublicKey: Uint8Array;
  assetId: string;
  roomVersion: number;
  keyCommitment: `0x${string}`;
}): Promise<CreatorRoomKeyEnvelope> {
  assertLength(input.roomKey, AES_KEY_BYTES, "Room key");
  assertLength(input.recoveryPublicKey, 32, "Creator recovery public key");
  if ((await sha256Hex(input.roomKey)) !== input.keyCommitment) {
    throw new Error("Room key does not match its commitment");
  }
  const ephemeralPrivateKey = x25519.utils.randomPrivateKey();
  const ephemeralPublicKey = x25519.getPublicKey(ephemeralPrivateKey);
  const recoveryPublicKey = bytesToBase64(input.recoveryPublicKey);
  const associatedData = canonicalJson({
    protocol: "vitnera-creator-room-key-envelope-v1",
    assetId: input.assetId,
    roomVersion: input.roomVersion,
    keyCommitment: input.keyCommitment,
    recoveryPublicKey,
  });
  const sharedSecret = x25519.getSharedSecret(ephemeralPrivateKey, input.recoveryPublicKey);
  const wrappingKey = await deriveEnvelopeKey(sharedSecret, associatedData);
  const iv = crypto.getRandomValues(new Uint8Array(AES_IV_BYTES));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: asBuffer(iv), additionalData: asBuffer(utf8(associatedData)) },
      wrappingKey,
      asBuffer(input.roomKey),
    ),
  );
  return {
    format: "vitnera-creator-room-key-envelope-v1",
    assetId: input.assetId,
    roomVersion: input.roomVersion,
    keyCommitment: input.keyCommitment,
    recoveryPublicKey,
    ephemeralPublicKey: bytesToBase64(ephemeralPublicKey),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(ciphertext),
    associatedData,
  };
}

export async function openCreatorRoomKeyEnvelope(
  envelope: CreatorRoomKeyEnvelope,
  recoveryPrivateKey: Uint8Array,
): Promise<Uint8Array> {
  assertLength(recoveryPrivateKey, 32, "Creator recovery private key");
  const recoveryPublicKey = x25519.getPublicKey(recoveryPrivateKey);
  if (bytesToHex(recoveryPublicKey) !== bytesToHex(base64ToBytes(envelope.recoveryPublicKey))) {
    throw new Error("This room was sealed to another creator recovery identity");
  }
  const expectedAssociatedData = canonicalJson({
    protocol: envelope.format,
    assetId: envelope.assetId,
    roomVersion: envelope.roomVersion,
    keyCommitment: envelope.keyCommitment,
    recoveryPublicKey: envelope.recoveryPublicKey,
  });
  if (expectedAssociatedData !== envelope.associatedData) {
    throw new Error("Creator room-key envelope metadata has been modified");
  }
  const sharedSecret = x25519.getSharedSecret(
    recoveryPrivateKey,
    base64ToBytes(envelope.ephemeralPublicKey),
  );
  const wrappingKey = await deriveEnvelopeKey(sharedSecret, envelope.associatedData);
  const roomKey = new Uint8Array(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: asBuffer(base64ToBytes(envelope.iv)),
        additionalData: asBuffer(utf8(envelope.associatedData)),
      },
      wrappingKey,
      asBuffer(base64ToBytes(envelope.ciphertext)),
    ),
  );
  if ((await sha256Hex(roomKey)) !== envelope.keyCommitment) {
    throw new Error("Recovered room key does not match its commitment");
  }
  return roomKey;
}

export async function createKeyEnvelope(input: {
  roomKey: Uint8Array;
  recipientPublicKey: Uint8Array;
  roomId: string;
  roomVersion: number;
  investor: string;
  metadataUri?: string;
}): Promise<KeyEnvelope> {
  assertLength(input.roomKey, AES_KEY_BYTES, "Room key");
  assertLength(input.recipientPublicKey, 32, "Recipient public key");
  const ephemeralPrivateKey = x25519.utils.randomPrivateKey();
  const ephemeralPublicKey = x25519.getPublicKey(ephemeralPrivateKey);
  const sharedSecret = x25519.getSharedSecret(ephemeralPrivateKey, input.recipientPublicKey);
  const associatedData = canonicalJson({
    protocol: "vitnera-envelope-v1",
    roomId: input.roomId,
    roomVersion: input.roomVersion,
    investor: input.investor.toLowerCase(),
    metadataUri: input.metadataUri,
  });
  const wrappingKey = await deriveEnvelopeKey(sharedSecret, associatedData);
  const iv = crypto.getRandomValues(new Uint8Array(AES_IV_BYTES));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: asBuffer(iv), additionalData: asBuffer(utf8(associatedData)) },
      wrappingKey,
      asBuffer(input.roomKey),
    ),
  );
  return {
    format: "vitnera-key-envelope-v1",
    roomId: input.roomId,
    roomVersion: input.roomVersion,
    investor: input.investor.toLowerCase(),
    ...(input.metadataUri ? { metadataUri: input.metadataUri } : {}),
    ephemeralPublicKey: bytesToBase64(ephemeralPublicKey),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(ciphertext),
    associatedData,
  };
}

export async function openKeyEnvelope(envelope: KeyEnvelope, privateKey: Uint8Array): Promise<Uint8Array> {
  assertLength(privateKey, 32, "Investor private key");
  const sharedSecret = x25519.getSharedSecret(privateKey, base64ToBytes(envelope.ephemeralPublicKey));
  const wrappingKey = await deriveEnvelopeKey(sharedSecret, envelope.associatedData);
  return new Uint8Array(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: asBuffer(base64ToBytes(envelope.iv)),
        additionalData: asBuffer(utf8(envelope.associatedData)),
      },
      wrappingKey,
      asBuffer(base64ToBytes(envelope.ciphertext)),
    ),
  );
}

export async function envelopeHash(envelope: KeyEnvelope): Promise<`0x${string}`> {
  return sha256Hex(utf8(canonicalJson(envelope)));
}

export async function exportRecoveryBundle(input: {
  keyPair: InvestorKeyPair;
  wallet: string;
  passphrase: string;
}): Promise<RecoveryExport> {
  if (input.passphrase.length < 12) throw new Error("Recovery passphrase must contain at least 12 characters");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(AES_IV_BYTES));
  const key = await deriveRecoveryKey(input.passphrase, salt, RECOVERY_ITERATIONS, ["encrypt"]);
  const payload = utf8(
    canonicalJson({
      privateKey: bytesToBase64(input.keyPair.privateKey),
      publicKey: bytesToBase64(input.keyPair.publicKey),
    }),
  );
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: asBuffer(iv) }, key, asBuffer(payload)),
  );
  return {
    format: "vitnera-recovery-v1",
    wallet: input.wallet.toLowerCase(),
    publicKey: bytesToBase64(input.keyPair.publicKey),
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(ciphertext),
    iterations: RECOVERY_ITERATIONS,
    createdAt: new Date().toISOString(),
  };
}

export async function importRecoveryBundle(bundle: RecoveryExport, passphrase: string): Promise<InvestorKeyPair> {
  if (!new Set(["vitnera-recovery-v1", "aegiskey-recovery-v1"]).has(bundle.format)) {
    throw new Error("Unsupported recovery format");
  }
  const key = await deriveRecoveryKey(passphrase, base64ToBytes(bundle.salt), bundle.iterations, ["decrypt"]);
  const plaintext = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: asBuffer(base64ToBytes(bundle.iv)) },
      key,
      asBuffer(base64ToBytes(bundle.ciphertext)),
    ),
  );
  const payload = JSON.parse(decodeUtf8(plaintext)) as { privateKey: string; publicKey: string };
  const privateKey = base64ToBytes(payload.privateKey);
  const publicKey = x25519.getPublicKey(privateKey);
  if (bytesToHex(publicKey) !== bytesToHex(base64ToBytes(payload.publicKey))) {
    throw new Error("Recovery bundle public key mismatch");
  }
  return { privateKey, publicKey };
}

export async function exportCreatorRecoveryIdentity(input: {
  identity: CreatorRecoveryIdentity;
  wallet: string;
  passphrase: string;
}): Promise<CreatorRecoveryExport> {
  if (input.passphrase.length < 12) throw new Error("Recovery passphrase must contain at least 12 characters");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(AES_IV_BYTES));
  const key = await deriveRecoveryKey(input.passphrase, salt, RECOVERY_ITERATIONS, ["encrypt"]);
  const payload = utf8(
    canonicalJson({
      privateKey: bytesToBase64(input.identity.privateKey),
      publicKey: bytesToBase64(input.identity.publicKey),
    }),
  );
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: asBuffer(iv) }, key, asBuffer(payload)),
  );
  return {
    format: "vitnera-creator-recovery-v1",
    wallet: input.wallet.toLowerCase(),
    publicKey: bytesToBase64(input.identity.publicKey),
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(ciphertext),
    iterations: RECOVERY_ITERATIONS,
    createdAt: new Date().toISOString(),
  };
}

export async function importCreatorRecoveryIdentity(
  bundle: CreatorRecoveryExport,
  passphrase: string,
): Promise<CreatorRecoveryIdentity> {
  if (bundle.format !== "vitnera-creator-recovery-v1") throw new Error("Unsupported creator recovery format");
  const key = await deriveRecoveryKey(passphrase, base64ToBytes(bundle.salt), bundle.iterations, ["decrypt"]);
  const plaintext = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: asBuffer(base64ToBytes(bundle.iv)) },
      key,
      asBuffer(base64ToBytes(bundle.ciphertext)),
    ),
  );
  const payload = JSON.parse(decodeUtf8(plaintext)) as { privateKey: string; publicKey: string };
  const privateKey = base64ToBytes(payload.privateKey);
  const publicKey = x25519.getPublicKey(privateKey);
  if (
    bytesToHex(publicKey) !== bytesToHex(base64ToBytes(payload.publicKey))
    || bytesToHex(publicKey) !== bytesToHex(base64ToBytes(bundle.publicKey))
  ) {
    throw new Error("Creator recovery identity public key mismatch");
  }
  return { privateKey, publicKey };
}

export async function exportRoomKeyRecovery(input: {
  roomKey: Uint8Array;
  roomId: string;
  roomVersion: number;
  passphrase: string;
}): Promise<RoomKeyRecoveryExport> {
  assertLength(input.roomKey, AES_KEY_BYTES, "Room key");
  if (input.passphrase.length < 12) throw new Error("Recovery passphrase must contain at least 12 characters");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(AES_IV_BYTES));
  const key = await deriveRecoveryKey(input.passphrase, salt, RECOVERY_ITERATIONS, ["encrypt"]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: asBuffer(iv) }, key, asBuffer(input.roomKey)),
  );
  return {
    format: "vitnera-room-key-recovery-v1",
    roomId: input.roomId,
    roomVersion: input.roomVersion,
    keyCommitment: await sha256Hex(input.roomKey),
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(ciphertext),
    iterations: RECOVERY_ITERATIONS,
    createdAt: new Date().toISOString(),
  };
}

export async function importRoomKeyRecovery(
  bundle: RoomKeyRecoveryExport,
  passphrase: string,
): Promise<Uint8Array> {
  if (!new Set(["vitnera-room-key-recovery-v1", "aegiskey-room-key-recovery-v1"]).has(bundle.format)) {
    throw new Error("Unsupported room-key recovery format");
  }
  const key = await deriveRecoveryKey(passphrase, base64ToBytes(bundle.salt), bundle.iterations, ["decrypt"]);
  const roomKey = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: asBuffer(base64ToBytes(bundle.iv)) },
      key,
      asBuffer(base64ToBytes(bundle.ciphertext)),
    ),
  );
  if ((await sha256Hex(roomKey)) !== bundle.keyCommitment) throw new Error("Room-key recovery commitment mismatch");
  return roomKey;
}

async function deriveEnvelopeKey(sharedSecret: Uint8Array, context: string): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey("raw", asBuffer(sharedSecret), "HKDF", false, ["deriveKey"]);
  // Keep the deployed v1 derivation salt so pre-rebrand key envelopes remain decryptable.
  const salt = await sha256Bytes(utf8("aegiskey-envelope-salt-v1"));
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: asBuffer(salt), info: asBuffer(utf8(context)) },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function deriveRecoveryKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
  usages: KeyUsage[],
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", asBuffer(utf8(passphrase)), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: asBuffer(salt), iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    usages,
  );
}

function assertLength(value: Uint8Array, expected: number, label: string): void {
  if (value.length !== expected) throw new Error(`${label} must contain ${expected} bytes`);
}
