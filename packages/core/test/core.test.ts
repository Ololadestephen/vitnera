import { describe, expect, it } from "vitest";
import {
  createKeyEnvelope,
  createCreatorRoomKeyEnvelope,
  decryptDocument,
  documentMerkleRoot,
  encryptDocument,
  envelopeHash,
  exportRecoveryBundle,
  exportCreatorRecoveryIdentity,
  exportRoomKeyRecovery,
  generateInvestorKeyPair,
  generateCreatorRecoveryIdentity,
  generateRoomKey,
  generatePrivatePublicSummary,
  importRecoveryBundle,
  importCreatorRecoveryIdentity,
  importRoomKeyRecovery,
  openKeyEnvelope,
  openCreatorRoomKeyEnvelope,
  type RwaManifest,
} from "../src/index.js";

describe("Vitnera cryptography", () => {
  it("encrypts and decrypts room documents with authenticated context", async () => {
    const roomKey = await generateRoomKey();
    const plaintext = new TextEncoder().encode("private asset agreement");
    const encrypted = await encryptDocument({
      plaintext,
      roomKey: roomKey.bytes,
      roomId: "room-1",
      roomVersion: 1,
      documentId: "lease",
      mimeType: "text/plain",
    });
    const decrypted = await decryptDocument({
      ciphertext: encrypted.ciphertext,
      roomKey: roomKey.bytes,
      iv: encrypted.iv,
      associatedData: encrypted.associatedData,
    });
    expect(new TextDecoder().decode(decrypted)).toBe("private asset agreement");
  });

  it("creates a wallet-bound X25519 key envelope", async () => {
    const roomKey = await generateRoomKey();
    const investor = generateInvestorKeyPair();
    const envelope = await createKeyEnvelope({
      roomKey: roomKey.bytes,
      recipientPublicKey: investor.publicKey,
      roomId: "1",
      roomVersion: 2,
      investor: "0x1111111111111111111111111111111111111111",
    });
    expect(await envelopeHash(envelope)).toMatch(/^0x[0-9a-f]{64}$/u);
    expect(await openKeyEnvelope(envelope, investor.privateKey)).toEqual(roomKey.bytes);
  });

  it("exports and restores an encrypted investor recovery bundle", async () => {
    const keyPair = generateInvestorKeyPair();
    const recovery = await exportRecoveryBundle({
      keyPair,
      wallet: "0x2222222222222222222222222222222222222222",
      passphrase: "a long test recovery passphrase",
    });
    const restored = await importRecoveryBundle(recovery, "a long test recovery passphrase");
    expect(restored.privateKey).toEqual(keyPair.privateKey);
    expect(restored.publicKey).toEqual(keyPair.publicKey);
    expect(recovery.format).toBe("vitnera-recovery-v1");

    const legacy = { ...recovery, format: "aegiskey-recovery-v1" as const };
    expect((await importRecoveryBundle(legacy, "a long test recovery passphrase")).privateKey).toEqual(
      keyPair.privateKey,
    );
  });

  it("exports and restores a passphrase-encrypted room key", async () => {
    const roomKey = await generateRoomKey();
    const recovery = await exportRoomKeyRecovery({
      roomKey: roomKey.bytes,
      roomId: "12",
      roomVersion: 3,
      passphrase: "a long issuer recovery passphrase",
    });
    expect(recovery.format).toBe("vitnera-room-key-recovery-v1");
    expect(await importRoomKeyRecovery(recovery, "a long issuer recovery passphrase")).toEqual(roomKey.bytes);

    const legacy = { ...recovery, format: "aegiskey-room-key-recovery-v1" as const };
    expect(await importRoomKeyRecovery(legacy, "a long issuer recovery passphrase")).toEqual(roomKey.bytes);
  });

  it("restores every room version through one encrypted creator recovery identity", async () => {
    const creator = generateCreatorRecoveryIdentity();
    const recovery = await exportCreatorRecoveryIdentity({
      identity: creator,
      wallet: "0x3333333333333333333333333333333333333333",
      passphrase: "one long creator recovery passphrase",
    });
    const restored = await importCreatorRecoveryIdentity(recovery, "one long creator recovery passphrase");
    const roomKey = await generateRoomKey();
    const envelope = await createCreatorRoomKeyEnvelope({
      roomKey: roomKey.bytes,
      recoveryPublicKey: restored.publicKey,
      assetId: "asset-7",
      roomVersion: 2,
      keyCommitment: roomKey.commitment,
    });

    expect(recovery.format).toBe("vitnera-creator-recovery-v1");
    expect(await openCreatorRoomKeyEnvelope(envelope, restored.privateKey)).toEqual(roomKey.bytes);
  });

  it("rejects a creator envelope sealed to another recovery identity", async () => {
    const roomKey = await generateRoomKey();
    const creator = generateCreatorRecoveryIdentity();
    const otherCreator = generateCreatorRecoveryIdentity();
    const envelope = await createCreatorRoomKeyEnvelope({
      roomKey: roomKey.bytes,
      recoveryPublicKey: creator.publicKey,
      assetId: "asset-8",
      roomVersion: 1,
      keyCommitment: roomKey.commitment,
    });

    await expect(openCreatorRoomKeyEnvelope(envelope, otherCreator.privateKey)).rejects.toThrow(
      "another creator recovery identity",
    );
  });

  it("builds a deterministic document Merkle root", async () => {
    const manifest: RwaManifest = {
      templateId: "rwa-basic-v1",
      assetId: "equipment-lagos-01",
      roomId: "1",
      version: 1,
      generatedAt: "2026-08-11T00:00:00.000Z",
      documents: [
        {
          id: "overview",
          type: "asset_overview",
          displayName: "Asset overview",
          mimeType: "application/pdf",
          ciphertextHash: `0x${"11".repeat(32)}`,
          ciphertextUri: "ipfs://invoice",
          encryptedSize: 100,
          iv: "AAAAAAAAAAAAAAAA",
          associatedData: "room-bound-context",
          required: true,
        },
      ],
    };
    expect(await documentMerkleRoot(manifest)).toBe(await documentMerkleRoot(manifest));
  });

  it("generates public copy locally without document content", () => {
    const summary = generatePrivatePublicSummary({
      title: "Equipment lease room",
      assetType: "equipment",
      assetLocation: "West Africa",
      evidenceTypes: ["asset_overview", "ownership_or_control"],
      evidenceCount: 2,
    });
    expect(summary).toContain("2 encrypted evidence files");
    expect(summary).toContain("controlled access");
    expect(summary).not.toContain("GEN-4401");
  });
});
