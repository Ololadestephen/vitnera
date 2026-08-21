import {
  bytesToBase64,
  exportCreatorRecoveryIdentity,
  generateCreatorRecoveryIdentity,
  importCreatorRecoveryIdentity,
  type CreatorRecoveryIdentity,
} from "@vitnera/core";
import { useEffect, useMemo, useState } from "react";
import { downloadJson, loadCreatorRecoveryIdentity, saveCreatorRecoveryIdentity } from "../lib/session";
import type { ChainRoom } from "../lib/types";

type UseCreatorRecoveryOptions = {
  address: `0x${string}` | undefined;
  ownRooms: ChainRoom[];
  notify: (message: string) => void;
};

export function useCreatorRecovery({ address, ownRooms, notify }: UseCreatorRecoveryOptions) {
  const [creatorRecovery, setCreatorRecovery] = useState<CreatorRecoveryIdentity | null>(null);
  const [creatorRecoveryPassphrase, setCreatorRecoveryPassphrase] = useState("");
  const [legacyRecoveryPassphrase, setLegacyRecoveryPassphrase] = useState("");

  useEffect(() => {
    setCreatorRecovery(address ? loadCreatorRecoveryIdentity(address) : null);
    setCreatorRecoveryPassphrase("");
    setLegacyRecoveryPassphrase("");
  }, [address]);

  const existingRecoveryPublicKeys = useMemo(() => new Set(
    ownRooms.flatMap((room) => room.metadata?.creatorRecoveryEnvelope?.recoveryPublicKey
      ? [room.metadata.creatorRecoveryEnvelope.recoveryPublicKey]
      : []),
  ), [ownRooms]);
  const requiresExistingCreatorRecovery = existingRecoveryPublicKeys.size > 0;

  async function setupIdentity() {
    if (!address) throw new Error("Connect an issuer wallet first");
    if (requiresExistingCreatorRecovery) {
      throw new Error("This wallet already has rooms. Import the creator recovery kit used to create them");
    }
    if (creatorRecoveryPassphrase.length < 12) {
      throw new Error("Use a creator recovery passphrase with at least 12 characters");
    }
    const identity = generateCreatorRecoveryIdentity();
    const bundle = await exportCreatorRecoveryIdentity({
      identity,
      wallet: address,
      passphrase: creatorRecoveryPassphrase,
    });
    saveCreatorRecoveryIdentity(address, identity);
    setCreatorRecovery(identity);
    downloadJson(bundle, `vitnera-${address.slice(2, 10)}-creator-recovery.json`);
    setCreatorRecoveryPassphrase("");
    notify("Creator recovery is ready. Keep the downloaded encrypted kit and its passphrase in separate safe places.");
  }

  async function importKit(file: File) {
    if (!address) throw new Error("Connect an issuer wallet first");
    if (creatorRecoveryPassphrase.length < 12) {
      throw new Error("Enter the creator recovery passphrase first");
    }
    const bundle = JSON.parse(await file.text()) as Parameters<typeof importCreatorRecoveryIdentity>[0];
    if (bundle.wallet.toLowerCase() !== address.toLowerCase()) {
      throw new Error("This creator recovery kit belongs to another wallet");
    }
    const identity = await importCreatorRecoveryIdentity(bundle, creatorRecoveryPassphrase);
    const importedPublicKey = bytesToBase64(identity.publicKey);
    if (requiresExistingCreatorRecovery && !existingRecoveryPublicKeys.has(importedPublicKey)) {
      throw new Error("This kit does not match the recovery identity used by this wallet's existing rooms");
    }
    saveCreatorRecoveryIdentity(address, identity);
    setCreatorRecovery(identity);
    setCreatorRecoveryPassphrase("");
    notify("Creator recovery loaded for this browser session.");
  }

  async function exportKit() {
    if (!address || !creatorRecovery) throw new Error("Set up or import creator recovery first");
    if (creatorRecoveryPassphrase.length < 12) {
      throw new Error("Use a creator recovery passphrase with at least 12 characters");
    }
    const bundle = await exportCreatorRecoveryIdentity({
      identity: creatorRecovery,
      wallet: address,
      passphrase: creatorRecoveryPassphrase,
    });
    downloadJson(bundle, `vitnera-${address.slice(2, 10)}-creator-recovery.json`);
    setCreatorRecoveryPassphrase("");
    notify("A fresh encrypted creator recovery kit was downloaded.");
  }

  return {
    creatorRecovery,
    creatorRecoveryPassphrase,
    setCreatorRecoveryPassphrase,
    legacyRecoveryPassphrase,
    setLegacyRecoveryPassphrase,
    requiresExistingCreatorRecovery,
    setupIdentity,
    importKit,
    exportKit,
  };
}
