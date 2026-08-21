import { canonicalJson, type AIReviewReport } from "@vitnera/core";
import { describe, expect, it } from "vitest";
import { recoverTypedDataAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { aiReviewTypes, signReviewAttestation } from "../src/attestation.js";
import { enforceReviewPolicy, runStructuredReview } from "../src/review.js";
import type { CreateReviewRequest } from "../src/schema.js";

const privateKey = `0x${"11".repeat(32)}` as Hex;
const contract = `0x${"22".repeat(20)}` as `0x${string}`;

const report: AIReviewReport = {
  templateId: "rwa-basic-v1",
  policyVersion: 1,
  reviewStatus: "ReviewReady",
  executiveSummary: "The submitted equipment lease evidence is complete and internally consistent.",
  keyFindings: ["Generator GEN-4401 is identified consistently across the submitted evidence."],
  missingDocuments: [],
  expiredDocuments: [],
  blockingIssues: [],
  riskFlags: [],
  inconsistencies: [],
  issuerQuestions: [],
};

const baseRequest: CreateReviewRequest = {
  roomId: "7",
  roomVersion: 1,
  documentRoot: `0x${"33".repeat(32)}`,
  templateId: `0x${"44".repeat(32)}`,
  reviewerNonce: "0",
  expiry: 2_000_000_000,
  consent: { accepted: true, statementVersion: "review-consent-v1" },
  documents: [
    "asset_overview",
    "ownership_or_control",
    "valuation_or_financial",
  ].map((type, index) => ({ id: String(index), type: type as never, displayName: type, text: "Complete readable evidence for this asset category." })),
};

describe("reviewer", () => {
  it("marks evidence the reviewer identifies as missing incomplete", () => {
    const enforced = enforceReviewPolicy({ ...report, missingDocuments: ["Valuation or financial evidence"] }, { documents: baseRequest.documents.slice(0, 1) });
    expect(enforced.reviewStatus).toBe("Incomplete");
    expect(enforced.missingDocuments).toContain("Valuation or financial evidence");
    expect(enforced.executiveSummary).toContain("review is incomplete");
    expect(enforced.keyFindings[0]).toContain("Missing or unreadable required evidence");
  });

  it("allows one comprehensive dossier to cover every evidence category", () => {
    const enforced = enforceReviewPolicy(report, {
      documents: [{ id: "dossier", type: "supporting_document", displayName: "Complete dossier", text: "Ownership, asset, and valuation evidence are combined in this dossier." }],
    });
    expect(enforced.reviewStatus).toBe("ReviewReady");
    expect(enforced.missingDocuments).toEqual([]);
  });

  it("removes placeholder punctuation from AI findings", () => {
    const enforced = enforceReviewPolicy({ ...report, keyFindings: ["-", "Valid asset identifier found."] }, baseRequest);
    expect(enforced.keyFindings).toEqual(["Valid asset identifier found."]);
  });

  it("signs the exact EIP-712 payload accepted by the contract", async () => {
    const signed = await signReviewAttestation({
      request: baseRequest,
      report,
      privateKey,
      chainId: 968,
      contract,
    });
    const recovered = await recoverTypedDataAddress({
      domain: signed.domain,
      types: aiReviewTypes,
      primaryType: "AIReviewAttestation",
      message: signed.attestation,
      signature: signed.signature,
    });
    expect(recovered).toBe(privateKeyToAccount(privateKey).address);
    expect(canonicalJson(report)).toContain("ReviewReady");
  });

  it("keeps ordinary risk observations visible without blocking publication", () => {
    const enforced = enforceReviewPolicy({
      ...report,
      reviewStatus: "NeedsReview",
      riskFlags: ["Future resale value is uncertain."],
      issuerQuestions: ["What maintenance reserve is planned?"],
    }, baseRequest);
    expect(enforced.reviewStatus).toBe("ReviewReady");
    expect(enforced.riskFlags).toHaveLength(1);
  });

  it("blocks publication for explicit evidence-integrity failures", () => {
    const enforced = enforceReviewPolicy({
      ...report,
      blockingIssues: ["The ownership schedule names a different asset identifier."],
    }, baseRequest);
    expect(enforced.reviewStatus).toBe("NeedsReview");
  });

  it("retries transient provider schema failures", async () => {
    let attempts = 0;
    const client = {
      responses: {
        parse: async () => {
          attempts += 1;
          if (attempts < 3) throw new Error("Generated JSON does not match the expected schema");
          return { output_parsed: report };
        },
      },
    };
    const reviewed = await runStructuredReview(client as never, "test-model", baseRequest);
    expect(reviewed.reviewStatus).toBe("ReviewReady");
    expect(reviewed.executiveSummary).toContain("equipment lease");
    expect(attempts).toBe(3);
  });

});
