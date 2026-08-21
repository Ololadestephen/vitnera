import { describe, expect, it } from "vitest";
import {
  createCreatorRoomKeyEnvelope,
  createKeyEnvelope,
  decryptDocument,
  documentMerkleRoot,
  encryptDocument,
  envelopeHash,
  exportCreatorRecoveryIdentity,
  generateCreatorRecoveryIdentity,
  generateInvestorKeyPair,
  generateRoomKey,
  generatePrivatePublicSummary,
  hashCanonical,
  importCreatorRecoveryIdentity,
  openCreatorRoomKeyEnvelope,
  openKeyEnvelope,
  sha256Hex,
  type RwaManifest,
} from "../src/index.js";

const ISSUER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const INVESTOR = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const PASSPHRASE = "one long creator recovery passphrase";

// Stands in for IPFS: ciphertext blobs addressable by URI.
const ciphertextStore = new Map<string, Uint8Array>();

type Draft = { id: string; type: RwaManifest["documents"][number]["type"]; content: string };

const drafts: Draft[] = [
  { id: "overview-1", type: "asset_overview", content: "CONFIDENTIAL solar asset overview GEN-4401" },
  { id: "ownership-1", type: "ownership_or_control", content: "Title deed and equipment schedules" },
  { id: "valuation-1", type: "valuation_or_financial", content: "Independent valuation report" },
];

async function sealVersion(input: {
  roomId: string;
  version: number;
  roomKey: Uint8Array;
}): Promise<{ manifest: RwaManifest; root: `0x${string}` }> {
    const documents = await Promise.all(drafts.map(async (draft) => {
    const encrypted = await encryptDocument({
      plaintext: new TextEncoder().encode(draft.content),
      roomKey: input.roomKey,
      roomId: input.roomId,
      roomVersion: input.version,
      documentId: draft.id,
      mimeType: "text/plain",
    });
    const ciphertextUri = `ipfs://room-${input.roomId}-v${input.version}/${draft.id}`;
    ciphertextStore.set(ciphertextUri, encrypted.ciphertext);
    return {
      id: draft.id,
      type: draft.type,
      displayName: `${draft.id}.txt`,
      mimeType: "text/plain",
      ciphertextHash: encrypted.ciphertextHash,
      ciphertextUri,
      encryptedSize: encrypted.ciphertext.length,
      iv: encrypted.iv,
      associatedData: encrypted.associatedData,
      required: draft.type !== "supporting_document",
    };
  }));
  const manifest: RwaManifest = {
    templateId: "rwa-basic-v1",
    assetId: `room-${input.roomId}`,
    roomId: input.roomId,
    version: input.version,
    generatedAt: "2026-08-21T00:00:00.000Z",
    documents,
  };
  return { manifest, root: await documentMerkleRoot(manifest) };
}

async function openVersion(
  manifest: RwaManifest,
  roomKey: Uint8Array,
  store: Map<string, Uint8Array>,
): Promise<string[]> {
  return Promise.all(manifest.documents.map(async (document) => {
    const bytes = store.get(document.ciphertextUri);
    if (!bytes) throw new Error(`Missing ciphertext at ${document.ciphertextUri}`);
    expect(await sha256Hex(bytes)).toBe(document.ciphertextHash);
    const plaintext = await decryptDocument({
      ciphertext: bytes,
      roomKey,
      iv: document.iv,
      associatedData: document.associatedData,
    });
    return new TextDecoder().decode(plaintext);
  }));
}

describe("Vitnera full room lifecycle (characterization)", () => {
  it("seals a room, survives a session loss, rotates versions, and grants investor access", async () => {
    // 1. Issuer sets up a passphrase-encrypted creator recovery identity.
    const creator = generateCreatorRecoveryIdentity();
    const kit = await exportCreatorRecoveryIdentity({ identity: creator, wallet: ISSUER, passphrase: PASSPHRASE });
    const restoredCreator = await importCreatorRecoveryIdentity(kit, PASSPHRASE);
    expect(restoredCreator.publicKey).toEqual(creator.publicKey);

    // 2. Room creation: fresh key, local encryption only, metadata anchored by hash.
    const roomId = "42";
    const v1 = await generateRoomKey();
    const sealedV1 = await sealVersion({ roomId, version: 1, roomKey: v1.bytes });
    const creatorEnvelopeV1 = await createCreatorRoomKeyEnvelope({
      roomKey: v1.bytes,
      recoveryPublicKey: restoredCreator.publicKey,
      assetId: sealedV1.manifest.assetId,
      roomVersion: 1,
      keyCommitment: v1.commitment,
    });
    const summary = generatePrivatePublicSummary({
      title: "Northbank Solar Portfolio",
      assetType: "equipment",
      evidenceTypes: drafts.map((draft) => draft.type),
      evidenceCount: drafts.length,
    });
    const metadataV1 = { format: "vitnera-rwa-room-v3", title: "Northbank Solar Portfolio", summary, manifest: sealedV1.manifest, creatorRecoveryEnvelope: creatorEnvelopeV1 };
    const metadataHashV1 = await hashCanonical(metadataV1);
    const metadataUri = `ipfs://room-${roomId}-v1-metadata.json`;
    expect(summary).not.toContain("GEN-4401");
    expect(metadataHashV1).toMatch(/^0x[0-9a-f]{64}$/u);
    for (const document of sealedV1.manifest.documents) {
      expect(document.ciphertextUri.startsWith("ipfs://")).toBe(true);
    }

    // 3. Browser session is lost; the issuer recovers the key from the downloaded kit.
    const recoveredV1 = await importCreatorRecoveryIdentity(kit, PASSPHRASE);
    const restoredKeyV1 = await openCreatorRoomKeyEnvelope(creatorEnvelopeV1, recoveredV1.privateKey);
    expect(restoredKeyV1).toEqual(v1.bytes);
    await expect(openVersion(sealedV1.manifest, restoredKeyV1, ciphertextStore)).resolves.toEqual(drafts.map((draft) => draft.content));

    // 4. Evidence changes: publish version 2 with a freshly rotated room key.
    const v2 = await generateRoomKey();
    expect(v2.bytes).not.toEqual(v1.bytes);
    const sealedV2 = await sealVersion({ roomId, version: 2, roomKey: v2.bytes });
    expect(sealedV2.root).not.toBe(sealedV1.root);
    const creatorEnvelopeV2 = await createCreatorRoomKeyEnvelope({
      roomKey: v2.bytes,
      recoveryPublicKey: restoredCreator.publicKey,
      assetId: sealedV2.manifest.assetId,
      roomVersion: 2,
      keyCommitment: v2.commitment,
    });
    // The old envelope cannot satisfy the new on-chain commitment.
    await expect(openCreatorRoomKeyEnvelope(creatorEnvelopeV2, creator.privateKey)).resolves.toEqual(v2.bytes);
    await expect(openVersion(sealedV2.manifest, v1.bytes, ciphertextStore)).rejects.toThrow();

    // 5. Investor deposits and requests access with a wallet-bound X25519 key.
    const investor = generateInvestorKeyPair();
    const keyEnvelope = await createKeyEnvelope({
      roomKey: v2.bytes,
      recipientPublicKey: investor.publicKey,
      roomId,
      roomVersion: 2,
      investor: INVESTOR,
      metadataUri,
    });
    const keyEnvelopeHash = await envelopeHash(keyEnvelope);
    expect(keyEnvelopeHash).toMatch(/^0x[0-9a-f]{64}$/u);
    expect(keyEnvelope.investor).toBe(INVESTOR.toLowerCase());

    // 6. Only the approved investor can open the envelope and decrypt.
    const openedByInvestor = await openKeyEnvelope(keyEnvelope, investor.privateKey);
    expect(await sha256Hex(openedByInvestor)).toBe(v2.commitment);
    await expect(openVersion(sealedV2.manifest, openedByInvestor, ciphertextStore)).resolves.toEqual(drafts.map((draft) => draft.content));

    const attacker = generateInvestorKeyPair();
    await expect(openKeyEnvelope(keyEnvelope, attacker.privateKey)).rejects.toThrow();
  });

  it("detects tampered ciphertext before decryption", async () => {
    const roomKey = (await generateRoomKey()).bytes;
    const sealed = await sealVersion({ roomId: "7", version: 1, roomKey });
    const tampered = structuredClone(sealed.manifest);
    tampered.documents[0].ciphertextHash = `0x${"99".repeat(32)}`;
    await expect(documentMerkleRoot(tampered)).resolves.not.toBe(sealed.root);
  });
});
