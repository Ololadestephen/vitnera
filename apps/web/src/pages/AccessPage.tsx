import {
  decryptDocument,
  deriveInvestorKeyPairFromSignature,
  envelopeHash,
  investorIdentityMessage,
  openKeyEnvelope,
  type KeyEnvelope,
} from "@vitnera/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileKey, PenLine, RotateCcw } from "lucide-react";
import { useState } from "react";
import { formatEther } from "viem";
import { useAccount } from "wagmi";
import { Busy, Notice, Status } from "../components/Status";
import { useRooms } from "../hooks/useRooms";
import { useTransaction } from "../hooks/useTransaction";
import { loadInvestorRequests } from "../lib/chain";
import { vitneraAbi, requestStatuses } from "../lib/contract";
import { explorerTx, requireContract } from "../lib/config";
import { downloadBytes, loadInvestorKey, saveInvestorKey } from "../lib/session";
import { fetchJson, fetchVerifiedBytes } from "../lib/storage";
import { publicRoomMetadataSchema } from "../lib/types";

export function AccessPage() {
  const { address } = useAccount();
  const tx = useTransaction();
  const rooms = useRooms();
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState<Record<string, string>>({});
  const requests = useQuery({
    queryKey: ["investor-requests", address], enabled: Boolean(tx.client && address),
    queryFn: () => loadInvestorRequests(tx.client!, address!),
  });
  const refunds = useQuery({
    queryKey: ["investor-refunds", address], enabled: Boolean(tx.client && address),
    queryFn: () => tx.client!.readContract({ address: requireContract(), abi: vitneraAbi, functionName: "claimableRefunds", args: [address!] }),
  });

  async function restoreKey(requestId: string, roomId: string, version: number) {
    if (!tx.wallet || !address) throw new Error("Connect the investor wallet first");
    setMessages((current) => ({ ...current, [requestId]: "Restoring your access identity..." }));
    const signature = await tx.wallet.signMessage({ account: address, message: investorIdentityMessage(address) });
    const pair = await deriveInvestorKeyPairFromSignature(signature);
    saveInvestorKey(address, roomId, version, pair);
    setMessages((current) => ({ ...current, [requestId]: "Access identity restored for this browser session." }));
  }

  async function decryptAll(requestId: string) {
    if (!address) throw new Error("Connect the investor wallet first");
    const request = requests.data?.find((item) => item.id.toString() === requestId);
    if (!request || request.status !== 2) throw new Error("This access grant is not active");
    let pair = loadInvestorKey(address, request.roomId.toString(), Number(request.roomVersion));
    if (!pair) {
      await restoreKey(requestId, request.roomId.toString(), Number(request.roomVersion));
      pair = loadInvestorKey(address, request.roomId.toString(), Number(request.roomVersion));
    }
    if (!pair) throw new Error("Restore your access identity before decrypting");
    const envelope = await fetchJson<KeyEnvelope>(request.envelopeUri);
    if ((await envelopeHash(envelope)).toLowerCase() !== request.envelopeHash.toLowerCase()) throw new Error("The key envelope failed its on-chain integrity check");
    if (envelope.investor.toLowerCase() !== address.toLowerCase()) throw new Error("The key envelope belongs to another wallet");
    const roomKey = await openKeyEnvelope(envelope, pair.privateKey);
    const metadata = publicRoomMetadataSchema.parse(await fetchJson(envelope.metadataUri ?? rooms.data?.find((room) => room.id === request.roomId)?.metadataUri ?? ""));
    if (metadata.manifest.version !== Number(request.roomVersion)) throw new Error("The approved envelope does not match this document version");
    for (const document of metadata.manifest.documents) {
      const ciphertext = await fetchVerifiedBytes(document.ciphertextUri, document.ciphertextHash);
      const plaintext = await decryptDocument({ ciphertext, roomKey, iv: document.iv, associatedData: document.associatedData });
      downloadBytes(plaintext, document.displayName, document.mimeType);
    }
    setMessages((current) => ({ ...current, [requestId]: `${metadata.manifest.documents.length} protected documents decrypted locally.` }));
  }

  async function refund(requestId: bigint) {
    await tx.send(() => tx.wallet!.writeContract({ address: requireContract(), abi: vitneraAbi, functionName: "refundExpiredRequest", args: [requestId] }));
    await queryClient.invalidateQueries({ queryKey: ["investor-requests", address] });
    await refunds.refetch();
  }

  async function withdrawRefund() {
    await tx.send(() => tx.wallet!.writeContract({ address: requireContract(), abi: vitneraAbi, functionName: "withdrawRefund" }));
    await refunds.refetch();
  }

  if (!address) return <div className="page empty-state"><h1>My access</h1><p>Connect the wallet that requested access.</p></div>;
  return (
    <div className="page page-enter">
      <div className="page-heading split-heading"><div><p className="eyebrow">Investor vault</p><h1>My access</h1><p>Manage escrow and your approved document versions.</p></div><div className="earnings-card"><RotateCcw /><span>Refund balance</span><strong>{formatEther(refunds.data ?? 0n)} BOT</strong><button disabled={!refunds.data || tx.pending} onClick={() => void withdrawRefund().catch(() => undefined)}>Withdraw refund</button></div></div>
      <Notice error={tx.error} />
      {tx.hash && <a className="text-link" href={explorerTx(tx.hash)} target="_blank" rel="noreferrer">View latest transaction</a>}
      {requests.isLoading && <div className="empty-state"><Busy label="Reading access grants" /></div>}
      {!requests.isLoading && requests.data?.length === 0 && <div className="empty-state">No access requests from this wallet.</div>}
      <div className="access-grid">
        {requests.data?.map((request) => {
          const room = rooms.data?.find((item) => item.id === request.roomId);
          const expired = Number(request.expiresAt) * 1000 <= Date.now();
          const hasKey = Boolean(loadInvestorKey(address, request.roomId.toString(), Number(request.roomVersion)));
          return <article className="panel access-card" key={request.id.toString()}>
            <div className="card-top"><span>REQUEST {request.id.toString()}</span><Status tone={request.status === 2 ? "good" : request.status === 1 ? "warn" : "neutral"}>{requestStatuses[request.status]}</Status></div>
            <h2>{room?.metadata?.title ?? `Data room ${request.roomId}`}</h2>
            <div className="key-values"><span>Version<strong>v{request.roomVersion.toString()}</strong></span><span>Escrow<strong>{formatEther(request.amount)} BOT</strong></span><span>Key<strong>{hasKey ? "Loaded" : "Required"}</strong></span></div>
            {request.status === 2 && <>
              {!hasKey && <button className="button secondary wide" onClick={() => void restoreKey(request.id.toString(), request.roomId.toString(), Number(request.roomVersion)).catch((error) => setMessages((current) => ({ ...current, [request.id.toString()]: error.message })))}><PenLine size={17} /> Restore access identity</button>}
              <button className="button primary wide" disabled={tx.pending} onClick={() => void decryptAll(request.id.toString()).catch((error) => setMessages((current) => ({ ...current, [request.id.toString()]: error.message })))}><Download size={17} /> Decrypt and download evidence</button>
            </>}
            {request.status === 1 && expired && <button className="button secondary wide" onClick={() => void refund(request.id).catch(() => undefined)}>Reclaim expired escrow</button>}
            {request.status === 1 && !expired && <p className="privacy-note"><FileKey size={17} /> Awaiting issuer approval. Escrow expires {new Date(Number(request.expiresAt) * 1000).toLocaleString()}.</p>}
            {messages[request.id.toString()] && <div className="notice">{messages[request.id.toString()]}</div>}
          </article>;
        })}
      </div>
    </div>
  );
}
