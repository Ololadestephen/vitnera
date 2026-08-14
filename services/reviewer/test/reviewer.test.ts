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
  templateId: "solar-installation-v1",
  policyVersion: 1,
  reviewStatus: "ReviewReady",
  missingDocuments: [],
  expiredDocuments: [],
  riskFlags: [],
  inconsistencies: [],
  issuerQuestions: [],
  extractedAssetSummary: {
    issuerName: "Sunward SPV",
    assetLocation: "Lagos",
    installedCapacityKw: 250,
    equipmentModels: ["PV-500"],
    counterparties: ["Sunward SPV"],
    materialDates: [],
    materialAmounts: [],
  },
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
    "ownership_agreement",
    "equipment_invoice",
    "equipment_specification",
    "serial_inventory",
    "commissioning_certificate",
  ].map((type, index) => ({ id: String(index), type: type as never, displayName: type, text: "evidence" })),
};

describe("reviewer", () => {
  it("deterministically marks missing required evidence incomplete", () => {
    const enforced = enforceReviewPolicy(report, { documents: baseRequest.documents.slice(0, 2) });
    expect(enforced.reviewStatus).toBe("Incomplete");
    expect(enforced.missingDocuments).toContain("Equipment specification");
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
    expect(attempts).toBe(3);
  });
});
