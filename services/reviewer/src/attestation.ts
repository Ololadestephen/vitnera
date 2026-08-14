import { REVIEW_POLICY_VERSION, canonicalJson } from "@vitnera/core";
import type { AIReviewReport } from "@vitnera/core";
import { privateKeyToAccount } from "viem/accounts";
import { keccak256, toBytes, type Address, type Hex } from "viem";
import type { CreateReviewRequest } from "./schema.js";

const REVIEW_STATUS = { ReviewReady: 1, NeedsReview: 2, Incomplete: 3 } as const;

export const aiReviewTypes = {
  AIReviewAttestation: [
    { name: "roomId", type: "uint256" },
    { name: "roomVersion", type: "uint64" },
    { name: "documentRoot", type: "bytes32" },
    { name: "templateId", type: "bytes32" },
    { name: "reviewStatus", type: "uint8" },
    { name: "riskFlagsHash", type: "bytes32" },
    { name: "reportHash", type: "bytes32" },
    { name: "policyVersion", type: "uint32" },
    { name: "nonce", type: "uint256" },
    { name: "expiry", type: "uint64" },
  ],
} as const;

export function hashReviewReport(report: AIReviewReport): Hex {
  return keccak256(toBytes(canonicalJson(report)));
}

export function hashRiskFlags(report: AIReviewReport): Hex {
  return keccak256(toBytes(canonicalJson(report.riskFlags)));
}

export function buildAttestation(request: CreateReviewRequest, report: AIReviewReport) {
  return {
    roomId: BigInt(request.roomId),
    roomVersion: BigInt(request.roomVersion),
    documentRoot: request.documentRoot as Hex,
    templateId: request.templateId as Hex,
    reviewStatus: REVIEW_STATUS[report.reviewStatus],
    riskFlagsHash: hashRiskFlags(report),
    reportHash: hashReviewReport(report),
    policyVersion: REVIEW_POLICY_VERSION,
    nonce: BigInt(request.reviewerNonce),
    expiry: BigInt(request.expiry),
  } as const;
}

export async function signReviewAttestation(input: {
  request: CreateReviewRequest;
  report: AIReviewReport;
  privateKey: Hex;
  chainId: number;
  contract: Address;
}) {
  const account = privateKeyToAccount(input.privateKey);
  const attestation = buildAttestation(input.request, input.report);
  // Must exactly match the EIP-712 domain configured by VitneraRWA.
  const domain = {
    name: "Vitnera RWA",
    version: "1",
    chainId: input.chainId,
    verifyingContract: input.contract,
  } as const;
  const signature = await account.signTypedData({
    domain,
    types: aiReviewTypes,
    primaryType: "AIReviewAttestation",
    message: attestation,
  });
  return { attestation, domain, reviewer: account.address, signature };
}
