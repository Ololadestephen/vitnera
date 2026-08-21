import { z } from "zod";

export const RWA_BASIC_TEMPLATE_ID = "rwa-basic-v1" as const;
export const REVIEW_POLICY_VERSION = 1 as const;

export const rwaAssetTypes = [
  "equipment",
  "real_estate",
  "commodities",
  "receivables",
  "other",
] as const;

export const rwaDocumentTypes = [
  "asset_overview",
  "ownership_or_control",
  "valuation_or_financial",
  "supporting_document",
] as const;

export const publicRwaAssetTypeSchema = z.enum(rwaAssetTypes);

export const rwaDocumentSchema = z.object({
  id: z.string().min(1).max(96),
  type: z.enum(rwaDocumentTypes),
  displayName: z.string().min(1).max(160),
  mimeType: z.string().min(1).max(96),
  ciphertextHash: z.string().regex(/^0x[0-9a-f]{64}$/iu),
  ciphertextUri: z.string().min(1).max(240),
  encryptedSize: z.number().int().nonnegative(),
  iv: z.string().min(1),
  associatedData: z.string().min(1),
  required: z.boolean(),
});

export const rwaManifestSchema = z.object({
  templateId: z.literal(RWA_BASIC_TEMPLATE_ID),
  assetId: z.string().min(1).max(96),
  roomId: z.string().min(1).max(96),
  version: z.number().int().positive(),
  generatedAt: z.string().datetime(),
  documents: z.array(rwaDocumentSchema).min(1).max(32),
});

// Internal names stay aligned with the Solidity enum and signed EIP-712 payload.
export const reviewStatusSchema = z.enum(["ReviewReady", "NeedsReview", "Incomplete"]);

export const aiReviewReportSchema = z.object({
  templateId: z.literal(RWA_BASIC_TEMPLATE_ID),
  policyVersion: z.literal(REVIEW_POLICY_VERSION),
  reviewStatus: reviewStatusSchema,
  executiveSummary: z.string().min(1).max(1_200),
  keyFindings: z.array(z.string().min(1).max(300)).max(12),
  missingDocuments: z.array(z.string().max(160)).max(32),
  expiredDocuments: z.array(z.string().max(160)).max(32),
  blockingIssues: z.array(z.string().max(500)).max(32),
  riskFlags: z.array(z.string().max(240)).max(32),
  inconsistencies: z.array(z.string().max(500)).max(32),
  issuerQuestions: z.array(z.string().max(500)).max(32),
});

export const creatorRoomKeyEnvelopeSchema = z.object({
  format: z.literal("vitnera-creator-room-key-envelope-v1"),
  assetId: z.string().min(1).max(96),
  roomVersion: z.number().int().positive(),
  keyCommitment: z.string().regex(/^0x[0-9a-f]{64}$/iu),
  recoveryPublicKey: z.string().min(1),
  ephemeralPublicKey: z.string().min(1),
  iv: z.string().min(1),
  ciphertext: z.string().min(1),
  associatedData: z.string().min(1),
});

export type RwaDocument = z.infer<typeof rwaDocumentSchema>;
export type RwaManifest = z.infer<typeof rwaManifestSchema>;
export type RwaAssetType = z.infer<typeof publicRwaAssetTypeSchema>;
export type AIReviewReport = z.infer<typeof aiReviewReportSchema>;
export type ReviewStatus = z.infer<typeof reviewStatusSchema>;
