import { z } from "zod";

export const SOLAR_TEMPLATE_ID = "solar-installation-v1" as const;
export const REVIEW_POLICY_VERSION = 1 as const;

export const solarDocumentTypes = [
  "ownership_agreement",
  "equipment_invoice",
  "equipment_specification",
  "serial_inventory",
  "commissioning_certificate",
  "site_or_equipment_lease",
  "insurance",
  "maintenance_agreement",
  "production_statement",
] as const;

export const solarDocumentSchema = z.object({
  id: z.string().min(1).max(96),
  type: z.enum(solarDocumentTypes),
  displayName: z.string().min(1).max(160),
  mimeType: z.string().min(1).max(96),
  ciphertextHash: z.string().regex(/^0x[0-9a-f]{64}$/iu),
  ciphertextUri: z.string().min(1).max(240),
  encryptedSize: z.number().int().nonnegative(),
  iv: z.string().min(1),
  associatedData: z.string().min(1),
  required: z.boolean(),
});

export const solarManifestSchema = z.object({
  templateId: z.literal(SOLAR_TEMPLATE_ID),
  assetId: z.string().min(1).max(96),
  roomId: z.string().min(1).max(96),
  version: z.number().int().positive(),
  generatedAt: z.string().datetime(),
  documents: z.array(solarDocumentSchema).min(1).max(64),
});

export const reviewStatusSchema = z.enum(["ReviewReady", "NeedsReview", "Incomplete"]);

export const aiReviewReportSchema = z.object({
  templateId: z.literal(SOLAR_TEMPLATE_ID),
  policyVersion: z.literal(REVIEW_POLICY_VERSION),
  reviewStatus: reviewStatusSchema,
  missingDocuments: z.array(z.string().max(160)).max(64),
  expiredDocuments: z.array(z.string().max(160)).max(64),
  riskFlags: z.array(z.string().max(240)).max(64),
  inconsistencies: z.array(z.string().max(500)).max(64),
  issuerQuestions: z.array(z.string().max(500)).max(64),
  extractedAssetSummary: z.object({
    issuerName: z.string().max(200).nullable(),
    assetLocation: z.string().max(240).nullable(),
    installedCapacityKw: z.number().nonnegative().nullable(),
    equipmentModels: z.array(z.string().max(160)).max(64),
    counterparties: z.array(z.string().max(200)).max(64),
    materialDates: z.array(z.object({ label: z.string().max(100), value: z.string().max(64) })).max(64),
    materialAmounts: z.array(
      z.object({ label: z.string().max(100), amount: z.number(), currency: z.string().max(12) }),
    ).max(64),
  }),
});

export type SolarDocument = z.infer<typeof solarDocumentSchema>;
export type SolarManifest = z.infer<typeof solarManifestSchema>;
export type AIReviewReport = z.infer<typeof aiReviewReportSchema>;
export type ReviewStatus = z.infer<typeof reviewStatusSchema>;
