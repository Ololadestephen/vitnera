import { solarManifestSchema, type SolarManifest } from "@vitnera/core";
import { z } from "zod";

export const publicRoomMetadataSchema = z.object({
  format: z.enum(["vitnera-rwa-room-v1", "aegiskey-rwa-room-v1"]),
  title: z.string().min(1).max(120),
  summary: z.string().min(1).max(600),
  assetLocation: z.string().min(1).max(160),
  issuerDisplayName: z.string().min(1).max(120),
  assetType: z.literal("Solar installation and equipment lease"),
  manifest: solarManifestSchema,
});

export type PublicRoomMetadata = z.infer<typeof publicRoomMetadataSchema>;

export type ChainRoom = {
  id: bigint;
  issuer: `0x${string}`;
  metadataHash: `0x${string}`;
  metadataUri: string;
  documentRoot: `0x${string}`;
  keyCommitment: `0x${string}`;
  termsHash: `0x${string}`;
  templateId: `0x${string}`;
  accessPrice: bigint;
  currentReviewId: bigint;
  version: bigint;
  requestTtl: bigint;
  createdAt: bigint;
  updatedAt: bigint;
  status: number;
  metadata?: PublicRoomMetadata;
  metadataVerified: boolean;
};

export type ChainRequest = {
  id: bigint;
  roomId: bigint;
  roomVersion: bigint;
  investor: `0x${string}`;
  encryptionPublicKey: `0x${string}`;
  amount: bigint;
  requestedAt: bigint;
  expiresAt: bigint;
  status: number;
  envelopeHash: `0x${string}`;
  envelopeUri: string;
};

export type DraftDocument = {
  id: string;
  type: SolarManifest["documents"][number]["type"];
  file: File;
  required: boolean;
};
