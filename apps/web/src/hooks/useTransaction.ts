import { useState } from "react";
import { usePublicClient, useWalletClient } from "wagmi";
import type { Hash, TransactionReceipt } from "viem";

export function useTransaction() {
  const { data: wallet } = useWalletClient();
  const client = usePublicClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const [hash, setHash] = useState<Hash>();

  async function send(operation: () => Promise<Hash>): Promise<TransactionReceipt> {
    if (!wallet || !client) throw new Error("Connect a BOT Chain wallet first");
    setPending(true);
    setError(undefined);
    try {
      const nextHash = await operation();
      setHash(nextHash);
      return await client.waitForTransactionReceipt({ hash: nextHash, confirmations: 1 });
    } catch (nextError) {
      setError(nextError);
      throw nextError;
    } finally {
      setPending(false);
    }
  }

  return { wallet, client, send, pending, error, hash, clearError: () => setError(undefined) };
}
