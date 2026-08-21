import { bytesToHex, exportRecoveryBundle, generateInvestorKeyPair } from "@vitnera/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, Download, ExternalLink, FileLock2, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { formatEther, zeroAddress } from "viem";
import { useAccount } from "wagmi";
import { Busy, Notice, Status } from "../components/Status";
import { useRooms } from "../hooks/useRooms";
import { useTransaction } from "../hooks/useTransaction";
import { vitneraAbi, requestStatuses, reviewStatuses, roomStatuses } from "../lib/contract";
import { explorerAddress, isInvestorVerified, resolveRegulatedAsset } from "../lib/erc3643";
import { explorerTx, requireContract } from "../lib/config";
import { downloadJson, saveInvestorKey } from "../lib/session";

export function RoomPage() {
  const { roomId = "0" } = useParams();
  const id = BigInt(roomId);
  const { address } = useAccount();
  const rooms = useRooms();
  const tx = useTransaction();
  const queryClient = useQueryClient();
  const [passphrase, setPassphrase] = useState("");
  const [message, setMessage] = useState<string>();
  const room = useMemo(() => rooms.data?.find((item) => item.id === id), [rooms.data, id]);

  const review = useQuery({
    queryKey: ["review", room?.currentReviewId.toString()],
    enabled: Boolean(tx.client && room && room.currentReviewId > 0n),
    queryFn: () => tx.client!.readContract({ address: requireContract(), abi: vitneraAbi, functionName: "getReview", args: [room!.currentReviewId] }),
  });
  const acknowledgedReview = useQuery({
    queryKey: ["acknowledged-review", room?.id.toString(), room?.currentReviewId.toString()],
    enabled: Boolean(tx.client && room && room.currentReviewId > 0n),
    queryFn: () => tx.client!.readContract({
      address: requireContract(), abi: vitneraAbi, functionName: "acknowledgedReviewId", args: [room!.id],
    }),
  });

  const request = useQuery({
    queryKey: ["latest-request", roomId, room?.version.toString(), address],
    enabled: Boolean(tx.client && room && address),
    queryFn: async () => {
      const requestId = await tx.client!.readContract({ address: requireContract(), abi: vitneraAbi, functionName: "latestRequestId", args: [id, room!.version, address!] });
      if (requestId === 0n) return null;
      const result = await tx.client!.readContract({ address: requireContract(), abi: vitneraAbi, functionName: "getAccessRequest", args: [requestId] });
      return { id: requestId, ...result, status: Number(result.status) };
    },
  });

  const regulatedToken = room && room.regulatedToken !== zeroAddress ? room.regulatedToken : undefined;
  const assetInfo = useQuery({
    queryKey: ["regulated-asset", regulatedToken],
    enabled: Boolean(tx.client && regulatedToken),
    queryFn: () => resolveRegulatedAsset(tx.client!, regulatedToken!),
  });
  const verified = useQuery({
    queryKey: ["investor-verified", assetInfo.data?.registry, address],
    enabled: Boolean(tx.client && assetInfo.data?.registry && address),
    queryFn: () => isInvestorVerified(tx.client!, assetInfo.data!.registry, address!),
  });

  async function requestAccess() {
    if (!room || !address || !tx.wallet) throw new Error("Connect a BOT Chain wallet first");
    if (passphrase.length < 12) throw new Error("Set a recovery passphrase with at least 12 characters");
    setMessage(undefined);
    const pair = generateInvestorKeyPair();
    const recovery = await exportRecoveryBundle({ keyPair: pair, wallet: address, passphrase });
    downloadJson(recovery, `vitnera-room-${roomId}-investor-recovery.json`);
    saveInvestorKey(address, roomId, Number(room.version), pair);
    await tx.send(() => tx.wallet!.writeContract({
      address: requireContract(), abi: vitneraAbi, functionName: "requestAccess",
      args: [id, bytesToHex(pair.publicKey)], value: room.accessPrice,
    }));
    await queryClient.invalidateQueries({ queryKey: ["latest-request", roomId] });
    setMessage("Access request escrowed. The issuer can now approve your wallet-bound key.");
  }

  if (rooms.isLoading || !room) return <div className="page empty-state"><Busy label="Loading data room" /></div>;
  const currentRequest = request.data;
  const canRequest = room.status === 1 && (!currentRequest || ![1, 2].includes(currentRequest.status));
  const reviewValue = review.data;
  const issuerAcknowledgedFindings = Boolean(
    room.currentReviewId > 0n
      && acknowledgedReview.data === room.currentReviewId
      && reviewValue
      && Number(reviewValue.status) !== 1,
  );

  return (
    <div className="page page-enter">
      <div className="room-hero">
        <div><p className="eyebrow">{room.metadata?.assetType.replaceAll("_", " ") ?? "Private asset"} · Room {room.id.toString()} · v{room.version.toString()}</p><h1>{room.metadata?.title ?? `Data room ${room.id}`}</h1><p>{room.metadata?.summary}</p></div>
        <div className="price-block"><span>Escrow deposit</span><strong>{formatEther(room.accessPrice)} BOT</strong>{room.regulatedToken !== zeroAddress && <span className="erc3643-chip">ERC-3643 verified investors</span>}<Status tone={room.status === 1 ? "good" : "warn"}>{roomStatuses[room.status]}</Status></div>
      </div>
      <div className="detail-grid">
        <section className="panel document-index">
          <div className="section-title"><FileLock2 /><div><p className="eyebrow">Encrypted evidence</p><h2>Document index</h2></div></div>
          {room.metadata?.manifest.documents.map((document) => (
            <div className="document-row" key={document.id}><div><strong>{document.displayName}</strong><span>{document.type.replaceAll("_", " ")}</span></div><Status>{document.required ? "Required" : "Supporting"}</Status></div>
          ))}
          <p className="privacy-note"><ShieldCheck size={17} /> Filenames and public labels are visible. File contents remain ciphertext on IPFS.</p>
        </section>
        <aside className="panel access-panel">
          <p className="eyebrow">Wallet-bound access</p>
          {currentRequest ? (
            <div className="request-state"><Status tone={currentRequest.status === 2 ? "good" : currentRequest.status === 1 ? "warn" : "neutral"}>{requestStatuses[currentRequest.status]}</Status><h2>{currentRequest.status === 2 ? "Access approved" : "Request recorded"}</h2><p>{currentRequest.status === 1 ? "Your BOT remains in escrow until approval, rejection, or expiry." : "Open My Access to retrieve the encrypted key envelope."}</p></div>
          ) : <><h2>Request protected access</h2><p>Your deposit is held by the contract. The issuer earns it only after approving a key envelope for this wallet.</p></>}
          {canRequest && <>
            {regulatedToken && <div className="regulated-panel">
              <div><span>Linked asset</span><strong>{assetInfo.data ? `${assetInfo.data.name ?? "ERC-3643 compatible"}${assetInfo.data.symbol ? ` · ${assetInfo.data.symbol}` : ""}` : <Busy label="Reading linked asset" />}</strong></div>
              <Status tone={verified.data === true ? "good" : verified.data === false ? "warn" : "neutral"}>{verified.data === true ? "Your wallet: ERC-3643 verified" : verified.data === false ? "Your wallet: not verified" : "Verification unknown"}</Status>
              <small>Eligibility is enforced on-chain before deposit and again at key release. Vitnera consumes the asset's official Identity Registry.</small>
              <div className="regulated-links">
                {assetInfo.data && <>
                  <a href={explorerAddress(regulatedToken)} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Token</a>
                  <a href={explorerAddress(assetInfo.data.registry)} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Registry</a>
                  {assetInfo.data.compliance && <a href={explorerAddress(assetInfo.data.compliance)} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Compliance</a>}
                </>}
              </div>
            </div>}
            <label className="field"><span>Recovery passphrase</span><input type="password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} placeholder="12+ characters" /><small>An encrypted recovery file downloads before payment.</small></label>
            <button className="button primary wide" disabled={tx.pending || !address || verified.data === false} onClick={() => void requestAccess().catch(() => undefined)}>{tx.pending ? <Busy label="Submitting escrow" /> : `Request access · ${formatEther(room.accessPrice)} BOT`}</button>
            {verified.data === false && <div className="notice">This room requires ERC-3643 verification and your wallet is not verified by the linked asset's Identity Registry. The contract would reject the deposit. Contact the asset issuer to become eligible.</div>}
          </>}
          {currentRequest?.status === 2 && <><a className="button primary wide" href="/access"><Download size={17} /> Open My Access</a><p className="privacy-note"><ShieldCheck size={17} /> Private evidence summaries are available only after approved access.</p></>}
          {!address && <div className="notice">Connect a wallet to request access.</div>}
          {room.status === 0 && <div className="notice">Access is paused while the issuer resolves missing, expired, or contradictory evidence. AI review checks evidence integrity; it does not decide whether the asset is a good investment.</div>}
          {room.status === 2 && <div className="notice">The issuer has paused new access requests.</div>}
          {room.status === 3 && <div className="notice">This room is archived and no longer accepts requests.</div>}
          <Notice error={tx.error} message={message} />
          {tx.hash && <a className="text-link" href={explorerTx(tx.hash)} target="_blank" rel="noreferrer">View latest transaction</a>}
        </aside>
      </div>
      <section className="panel review-summary">
        <div><p className="eyebrow">AI review evidence</p><h2>{reviewValue ? reviewStatuses[Number(reviewValue.status)] : "Review not recorded"}</h2></div>
        {reviewValue && <div className="review-facts"><span><Clock /> Expires {new Date(Number(reviewValue.expiry) * 1000).toLocaleDateString()}</span><span><ShieldCheck /> Reviewer {reviewValue.reviewer.slice(0, 8)}...{reviewValue.reviewer.slice(-6)}</span><span>Report {reviewValue.reportHash.slice(0, 12)}...</span>{issuerAcknowledgedFindings && <span className="issuer-override-label">Issuer published with acknowledged findings</span>}</div>}
      </section>
      {issuerAcknowledgedFindings && <div className="notice review-disclosure">The AI report contains unresolved evidence warnings. The issuer acknowledged those findings on-chain and chose to publish. This is not an AI approval or investment recommendation.</div>}
    </div>
  );
}
