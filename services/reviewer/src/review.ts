import {
  REVIEW_POLICY_VERSION,
  RWA_BASIC_TEMPLATE_ID,
  aiReviewReportSchema,
  canonicalJson,
  type AIReviewReport,
} from "@vitnera/core";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { CreateReviewRequest } from "./schema.js";
import { reviewerOutputSchema } from "./schema.js";

const SYSTEM_PROMPT = `You are Vitnera's real-world asset document intelligence reviewer.
Analyze only the supplied document text. Extract facts, compare asset identifiers, parties, dates,
amounts, ownership or control claims, valuation evidence, and document validity. Never claim legal
verification, regulatory approval, or investment safety.
This is an evidence-integrity gate, not an investment recommendation or approval decision.
Use ReviewReady when required evidence is present, readable, current, and not directly contradictory.
The evidence categories may be combined in one comprehensive document. Document type labels are hints only;
judge coverage from the actual text and never require three separate files merely because three categories exist.
Ordinary commercial risk, valuation uncertainty, issuer questions, or an unattractive investment must remain
visible in riskFlags or issuerQuestions but must not prevent ReviewReady.
Use NeedsReview only for expired required evidence, direct contradictions, or evidence that cannot substantiate
ownership/control or valuation claims. Put every issue that must block publication in blockingIssues.
Use Incomplete when required documents are absent or unreadable. Be concise and factual.
Return exactly one JSON object matching the supplied schema.
executiveSummary must be a plain string containing two to four concise sentences.
keyFindings must be an array of short factual strings. Do not return nested asset-summary objects.`;

const RETRY_PROMPT = `Your previous response did not match the required JSON schema.
Return one object only. Do not wrap it in an array or markdown. Every required field must be present.`;

export type ReviewClient = Pick<OpenAI, "responses">;

export async function runStructuredReview(
  client: ReviewClient,
  model: string,
  request: CreateReviewRequest,
): Promise<AIReviewReport> {
  const unreadable = request.documents.filter((document) => document.text.trim().length < 20);
  if (unreadable.length > 0) {
    throw new Error(`No readable text was extracted from: ${unreadable.map((document) => document.displayName).join(", ")}`);
  }
  const input = canonicalJson({
    template: RWA_BASIC_TEMPLATE_ID,
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
          ...(attempt > 1 ? [{ role: "user" as const, content: RETRY_PROMPT }] : []),
        ],
        text: { format: zodTextFormat(reviewerOutputSchema, "rwa_due_diligence_review") },
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
  _request: Pick<CreateReviewRequest, "documents">,
): AIReviewReport {
  const missingDocuments = cleanList(report.missingDocuments);
  const expiredDocuments = cleanList(report.expiredDocuments);
  const blockingIssues = cleanList(report.blockingIssues);
  const riskFlags = cleanList(report.riskFlags);
  const inconsistencies = cleanList(report.inconsistencies);
  const issuerQuestions = cleanList(report.issuerQuestions);
  let reviewStatus = report.reviewStatus;
  let executiveSummary = report.executiveSummary;
  let keyFindings = cleanList(report.keyFindings);
  if (missingDocuments.length > 0) {
    reviewStatus = "Incomplete";
    executiveSummary = `The review is incomplete because required evidence is missing or unreadable: ${missingDocuments.join(", ")}.`;
    keyFindings = [`Missing or unreadable required evidence: ${missingDocuments.join(", ")}.`, ...keyFindings].slice(0, 12);
  } else if (expiredDocuments.length > 0 || inconsistencies.length > 0 || blockingIssues.length > 0) {
    reviewStatus = "NeedsReview";
    if (report.reviewStatus === "ReviewReady") {
      executiveSummary = `The evidence requires attention because unresolved review findings remain. ${executiveSummary}`;
    }
  } else {
    // Commercial observations are disclosed but do not turn the reviewer into an investment gatekeeper.
    reviewStatus = "ReviewReady";
  }
  return aiReviewReportSchema.parse({
    ...report,
    reviewStatus,
    executiveSummary,
    keyFindings,
    missingDocuments,
    expiredDocuments,
    blockingIssues,
    riskFlags,
    inconsistencies,
    issuerQuestions,
  });
}

function cleanList(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter((value) => value.length > 1 && !/^[-–—.\s]+$/u.test(value))));
}

export function createAIClient(apiKey: string, baseURL: string): OpenAI {
  return new OpenAI({ apiKey, baseURL });
}
