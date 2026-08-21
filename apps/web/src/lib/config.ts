import { defineChain, type Address } from "viem";

const chainId = Number(import.meta.env.VITE_BOTCHAIN_CHAIN_ID ?? 968);
const rpcUrl = import.meta.env.VITE_BOTCHAIN_RPC_URL ?? "https://rpc.bohr.life";

export const botchain = defineChain({
  id: chainId,
  name: chainId === 677 ? "BOT Chain" : "BOT Chain Testnet",
  nativeCurrency: { name: "BOT", symbol: "BOT", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
  blockExplorers: { default: { name: "BOT Chain Explorer", url: "https://scan.botchain.ai" } },
  testnet: chainId !== 677,
});

export const appConfig = {
  chainId,
  rpcUrl,
  contract: import.meta.env.VITE_VITNERA_CONTRACT as Address | undefined,
  storageApi: (import.meta.env.DEV ? "/storage-api" : (import.meta.env.VITE_STORAGE_API_URL ?? "http://localhost:8787")).replace(/\/$/u, ""),
  reviewerApi: (import.meta.env.VITE_REVIEWER_API_URL ?? "http://localhost:8790").replace(/\/$/u, ""),
  deploymentBlock: BigInt(import.meta.env.VITE_DEPLOYMENT_BLOCK ?? "0"),
};

export function requireContract(): Address {
  if (!appConfig.contract) throw new Error("VITE_VITNERA_CONTRACT is not configured");
  return appConfig.contract;
}

export function explorerTx(hash: string): string {
  return `${botchain.blockExplorers.default.url}/tx/${hash}`;
}
