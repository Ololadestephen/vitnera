import {
  REVIEW_POLICY_VERSION,
  SOLAR_TEMPLATE_ID,
  aiReviewReportSchema,
  canonicalJson,
  type AIReviewReport,
} from "@vitnera/core";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { CreateReviewRequest } from "./schema.js";
import { reviewerOutputSchema } from "./schema.js";

const REQUIRED_DOCUMENTS = new Map([
  ["ownership_agreement", "Ownership agreement"],
  ["equipment_invoice", "Equipment invoice"],
  ["equipment_specification", "Equipment specification"],
  ["serial_inventory", "Serial inventory"],
  ["commissioning_certificate", "Commissioning certificate"],
]);

const SYSTEM_PROMPT = `You are Vitnera's solar-asset document intelligence reviewer.
Analyze only the supplied document text. Extract facts, compare identifiers, parties, dates, amounts,
equipment models, capacity, and document validity. Never claim legal verification or investment safety.
Use ReviewReady only when the required evidence is present and you find no material unresolved conflict.
Use NeedsReview for material inconsistencies, ambiguity, expiry, or unanswered diligence questions.
Use Incomplete when required documents are absent or unreadable. Be concise and factual.
The extractedAssetSummary field must be one object, never an array.`;

export type ReviewClient = Pick<OpenAI, "responses">;

export async function runStructuredReview(
  client: ReviewClient,
  model: string,
  request: CreateReviewRequest,
): Promise<AIReviewReport> {
  const input = canonicalJson({
    template: SOLAR_TEMPLATE_ID,
    policyVersion: REVIEW_POLICY_VERSION,
    documents: request.documents,
  });
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await client.responses.parse({
        model,
        input: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: input },
        ],
        text: { format: zodTextFormat(reviewerOutputSchema, "solar_due_diligence_review") },
      });
      if (!response.output_parsed) throw new Error("The AI reviewer returned no structured report");
      return enforceReviewPolicy(response.output_parsed, request);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export function enforceReviewPolicy(
  report: AIReviewReport,
  request: Pick<CreateReviewRequest, "documents">,
): AIReviewReport {
  const suppliedTypes = new Set(request.documents.map((document) => document.type));
  const deterministicMissing = Array.from(REQUIRED_DOCUMENTS.entries())
    .filter(([type]) => !suppliedTypes.has(type as never))
    .map(([, label]) => label);
  const missingDocuments = Array.from(new Set([...report.missingDocuments, ...deterministicMissing]));
  let reviewStatus = report.reviewStatus;
  if (deterministicMissing.length > 0) reviewStatus = "Incomplete";
  else if (report.expiredDocuments.length > 0 || report.inconsistencies.length > 0 || report.riskFlags.length > 0) {
    reviewStatus = "NeedsReview";
  }
  return aiReviewReportSchema.parse({ ...report, reviewStatus, missingDocuments });
}

export function createAIClient(apiKey: string, baseURL: string): OpenAI {
  return new OpenAI({ apiKey, baseURL });
}
