import {
  REVIEW_POLICY_VERSION,
  RWA_BASIC_TEMPLATE_ID,
  aiReviewReportSchema,
  rwaDocumentTypes,
} from "@vitnera/core";
import { z } from "zod";

export const reviewDocumentSchema = z.object({
  id: z.string().min(1).max(96),
  type: z.enum(rwaDocumentTypes),
  displayName: z.string().min(1).max(160),
  text: z.string().trim().min(20).max(200_000),
});

export const createReviewRequestSchema = z.object({
  roomId: z.string().regex(/^\d+$/u),
  roomVersion: z.number().int().positive(),
  documentRoot: z.string().regex(/^0x[0-9a-f]{64}$/iu),
  templateId: z.string().regex(/^0x[0-9a-f]{64}$/iu),
  reviewerNonce: z.string().regex(/^\d+$/u),
  expiry: z.number().int().positive(),
  consent: z.object({
    accepted: z.literal(true),
    statementVersion: z.literal("review-consent-v1"),
  }),
  documents: z.array(reviewDocumentSchema).min(1).max(32),
});

export const reviewerOutputSchema = aiReviewReportSchema.extend({
  templateId: z.literal(RWA_BASIC_TEMPLATE_ID),
  policyVersion: z.literal(REVIEW_POLICY_VERSION),
});

export type CreateReviewRequest = z.infer<typeof createReviewRequestSchema>;
