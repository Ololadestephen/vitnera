import type { PublicClient } from "viem";
import { erc3643RegistryAbi, erc3643TokenAbi } from "./contract";

export type RegulatedAssetInfo = {
  token: `0x${string}`;
  registry: `0x${string}`;
  compliance?: `0x${string}`;
  name?: string;
  symbol?: string;
  paused?: boolean;
};

export function explorerAddress(address: string): string {
  return `https://scan.botchain.ai/address/${address}`;
}

/// Best-effort display resolution. Security gating always happens on-chain;
/// a failed read here only degrades the badge, never unlocks anything.
export async function resolveRegulatedAsset(
  client: PublicClient,
  token: `0x${string}`,
): Promise<RegulatedAssetInfo | null> {
  try {
    const [registry, name, symbol, compliance, paused] = await Promise.all([
      client.readContract({ address: token, abi: erc3643TokenAbi, functionName: "identityRegistry" }),
      client.readContract({ address: token, abi: erc3643TokenAbi, functionName: "name" }).catch(() => undefined),
      client.readContract({ address: token, abi: erc3643TokenAbi, functionName: "symbol" }).catch(() => undefined),
      client.readContract({ address: token, abi: erc3643TokenAbi, functionName: "compliance" }).catch(() => undefined),
      client.readContract({ address: token, abi: erc3643TokenAbi, functionName: "paused" }).catch(() => undefined),
    ]);
    if (!registry) return null;
    return {
      token,
      registry,
      name: name || undefined,
      symbol: symbol || undefined,
      compliance: compliance || undefined,
      paused: typeof paused === "boolean" ? paused : undefined,
    };
  } catch {
    return null;
  }
}

/// Fail-open by design: the contract re-checks isVerified at deposit and
/// approval, so a failed read here must not lock out legitimate investors.
export async function isInvestorVerified(
  client: PublicClient,
  registry: `0x${string}`,
  investor: `0x${string}`,
): Promise<boolean | null> {
  try {
    return await client.readContract({
      address: registry, abi: erc3643RegistryAbi, functionName: "isVerified", args: [investor],
    });
  } catch {
    return null;
  }
}
