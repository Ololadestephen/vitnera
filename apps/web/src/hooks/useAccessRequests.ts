import { useQueryClient } from "@tanstack/react-query";
import { createKeyEnvelope, envelopeHash, hexToBytes } from "@vitnera/core";
import type { Hex } from "viem";
import { useQuery } from "@tanstack/react-query";
import { loadRoomRequests } from "../lib/chain";
import { vitneraAbi } from "../lib/contract";
import { requireContract } from "../lib/config";
import { uploadJson } from "../lib/storage";
import type { ChainRoom } from "../lib/types";
import type { useTransaction } from "./useTransaction";

type UseAccessRequestsOptions = {
  tx: ReturnType<typeof useTransaction>;
  selected: ChainRoom | undefined;
  resolveRoomKey: () => Promise<Uint8Array>;
  notify: (message: string) => void;
};

export function useAccessRequests({ tx, selected, resolveRoomKey, notify }: UseAccessRequestsOptions) {
  const queryClient = useQueryClient();
  const requests = useQuery({
    queryKey: ["room-requests", selected?.id.toString()],
    enabled: Boolean(tx.client && selected),
    queryFn: () => loadRoomRequests(tx.client!, selected!.id),
  });

  async function approveRequest(requestId: bigint, publicKey: Hex) {
    if (!selected) throw new Error("Select a room first");
    const roomKey = await resolveRoomKey();
    const request = requests.data?.find((item) => item.id === requestId);
    if (!request) throw new Error("Request not found");
    const envelope = await createKeyEnvelope({ roomKey, recipientPublicKey: hexToBytes(publicKey), roomId: selected.id.toString(), roomVersion: Number(selected.version), investor: request.investor, metadataUri: selected.metadataUri });
    const uploaded = await uploadJson(envelope, `vitnera-request-${requestId}-key-envelope.json`);
    const keyEnvelopeHash = await envelopeHash(envelope);
    await tx.send(() => tx.wallet!.writeContract({ address: requireContract(), abi: vitneraAbi, functionName: "approveAccess", args: [requestId, keyEnvelopeHash, uploaded.uri] }));
    await queryClient.invalidateQueries({ queryKey: ["room-requests", selected.id.toString()] });
    notify(`Request ${requestId} approved. Earnings are now claimable.`);
  }

  async function rejectRequest(requestId: bigint) {
    await tx.send(() => tx.wallet!.writeContract({ address: requireContract(), abi: vitneraAbi, functionName: "rejectAccess", args: [requestId] }));
    await queryClient.invalidateQueries({ queryKey: ["room-requests", selected?.id.toString()] });
  }

  return { requests, approveRequest, rejectRequest };
}
