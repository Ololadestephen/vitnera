import {
  SOLAR_TEMPLATE_ID,
  REVIEW_POLICY_VERSION,
  canonicalJson,
  createKeyEnvelope,
  documentMerkleRoot,
  encryptDocument,
  envelopeHash,
  exportRoomKeyRecovery,
  generateRoomKey,
  hashCanonical,
  hexToBytes,
  importRoomKeyRecovery,
  solarDocumentTypes,
  sha256Hex,
  type AIReviewReport,
  type SolarManifest,
} from "@vitnera/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Bot, CircleDollarSign, FileKey, KeyRound, RefreshCw, UploadCloud } from "lucide-react";
import { useMemo, useState } from "react";
import { decodeEventLog, formatEther, keccak256, parseEther, toBytes, type Hex } from "viem";
import { useAccount } from "wagmi";
import { Busy, Notice, Status } from "../components/Status";
import { useRooms } from "../hooks/useRooms";
import { useTransaction } from "../hooks/useTransaction";
import { loadRoomRequests } from "../lib/chain";
import { vitneraAbi, requestStatuses, roomStatuses } from "../lib/contract";
import { appConfig, explorerTx, requireContract } from "../lib/config";
import { downloadJson, loadRoomKey, saveRoomKey } from "../lib/session";
import { uploadEncryptedBlob, uploadJson } from "../lib/storage";
import type { ChainRoom, DraftDocument, PublicRoomMetadata } from "../lib/types";

const requiredTypes = [
  "ownership_agreement",
  "equipment_invoice",
  "equipment_specification",
  "serial_inventory",
  "commissioning_certificate",
] as const;

type ReviewText = { id: string; type: DraftDocument["type"]; displayName: string; text: string };
type SignedReview = {
  report: AIReviewReport;
  signature: Hex;
  attestation: {
    roomId: string; roomVersion: string; documentRoot: Hex; templateId: Hex; reviewStatus: number;
    riskFlagsHash: Hex; reportHash: Hex; policyVersion: number; nonce: string; expiry: string;
  };
};

export function StudioPage() {
  const { address } = useAccount();
  const rooms = useRooms();
  const tx = useTransaction();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string>();
  const [documents, setDocuments] = useState<DraftDocument[]>([]);
  const [reviewTexts, setReviewTexts] = useState<Record<string, ReviewText[]>>({});
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [location, setLocation] = useState("");
  const [issuerName, setIssuerName] = useState("");
  const [price, setPrice] = useState("0.05");
  const [recoveryPassphrase, setRecoveryPassphrase] = useState("");
  const [message, setMessage] = useState<string>();
  const [reviewResult, setReviewResult] = useState<AIReviewReport>();

  const ownRooms = useMemo(() => (rooms.data ?? []).filter((room) => room.issuer.toLowerCase() === address?.toLowerCase()), [rooms.data, address]);
  const selected = ownRooms.find((room) => room.id.toString() === selectedId) ?? ownRooms[0];
  const requests = useQuery({
    queryKey: ["room-requests", selected?.id.toString()],
    enabled: Boolean(tx.client && selected),
    queryFn: () => loadRoomRequests(tx.client!, selected!.id),
  });
  const earnings = useQuery({
    queryKey: ["issuer-earnings", address], enabled: Boolean(tx.client && address),
    queryFn: () => tx.client!.readContract({ address: requireContract(), abi: vitneraAbi, functionName: "claimableEarnings", args: [address!] }),
  });

  function chooseFiles(files: FileList | null) {
    if (!files) return;
    setDocuments(Array.from(files).map((file, index) => ({
      id: crypto.randomUUID(), file,
      type: (requiredTypes[index] ?? "production_statement") as DraftDocument["type"],
      required: index < requiredTypes.length,
    })));
  }

  async function prepareVersion(roomId: string, version: number, roomKey: Uint8Array) {
    if (!address || documents.length === 0) throw new Error("Select at least one source document");
    const encryptedDocuments: SolarManifest["documents"] = [];
    const texts: ReviewText[] = [];
    for (const item of documents) {
      const plaintext = new Uint8Array(await item.file.arrayBuffer());
      const encrypted = await encryptDocument({
        plaintext, roomKey, roomId, roomVersion: version, documentId: item.id,
        mimeType: item.file.type || "application/octet-stream",
      });
      const uploaded = await uploadEncryptedBlob(encrypted.ciphertext, `${item.id}.aegis`, encrypted.ciphertextHash);
      encryptedDocuments.push({
        id: item.id, type: item.type, displayName: item.file.name,
        mimeType: item.file.type || "application/octet-stream", ciphertextHash: encrypted.ciphertextHash,
        ciphertextUri: uploaded.uri, encryptedSize: encrypted.ciphertext.length, iv: encrypted.iv,
        associatedData: encrypted.associatedData, required: item.required,
      });
      texts.push({ id: item.id, type: item.type, displayName: item.file.name, text: await extractReviewText(item.file) });
    }
    const manifest: SolarManifest = {
      templateId: SOLAR_TEMPLATE_ID, assetId: roomId, roomId, version,
      generatedAt: new Date().toISOString(), documents: encryptedDocuments,
    };
    return { manifest, texts, root: await documentMerkleRoot(manifest) };
  }

  async function createRoom() {
    if (!tx.wallet || !address) throw new Error("Connect an issuer wallet first");
    if (!title || !summary || !location || !issuerName) throw new Error("Complete the public room details");
    const roomKey = await generateRoomKey();
    const draftId = crypto.randomUUID();
    const prepared = await prepareVersion(draftId, 1, roomKey.bytes);
    const metadata: PublicRoomMetadata = {
      format: "vitnera-rwa-room-v1", title, summary, assetLocation: location,
      issuerDisplayName: issuerName, assetType: "Solar installation and equipment lease", manifest: prepared.manifest,
    };
    const metadataHash = await hashCanonical(metadata);
    const metadataUpload = await uploadJson(metadata, `vitnera-${draftId}-metadata.json`);
    const termsHash = await hashCanonical({ price, requestTtl: 172800, settlement: "issuer-on-approval" });
    const receipt = await tx.send(() => tx.wallet!.writeContract({
      address: requireContract(), abi: vitneraAbi, functionName: "createDataRoom",
      args: [metadataHash, metadataUpload.uri, prepared.root, roomKey.commitment, termsHash,
        keccak256(toBytes(SOLAR_TEMPLATE_ID)), parseEther(price), 172800n],
    }));
    const created = receipt.logs.flatMap((log) => {
      try { const event = decodeEventLog({ abi: vitneraAbi, data: log.data, topics: log.topics }); return event.eventName === "DataRoomCreated" ? [event.args.roomId] : []; }
      catch { return []; }
    })[0];
    if (!created) throw new Error("The room transaction landed but its creation event was not found");
    saveRoomKey(address, created.toString(), 1, roomKey.bytes);
    setReviewTexts((current) => ({ ...current, [created.toString()]: prepared.texts }));
    setSelectedId(created.toString());
    await queryClient.invalidateQueries({ queryKey: ["rwa-rooms"] });
    setMessage(`Data room ${created} created. Run its AI review before activation.`);
  }

  async function publishNewVersion() {
    if (!selected || !tx.wallet || !address) throw new Error("Select one of your rooms");
    const nextVersion = Number(selected.version) + 1;
    const roomKey = await generateRoomKey();
    const prepared = await prepareVersion(selected.id.toString(), nextVersion, roomKey.bytes);
    const metadata: PublicRoomMetadata = {
      ...(selected.metadata ?? { format: "vitnera-rwa-room-v1", title, summary, assetLocation: location, issuerDisplayName: issuerName, assetType: "Solar installation and equipment lease" }),
      manifest: prepared.manifest,
    };
    const metadataHash = await hashCanonical(metadata);
    const uploaded = await uploadJson(metadata, `vitnera-room-${selected.id}-v${nextVersion}-metadata.json`);
    await tx.send(() => tx.wallet!.writeContract({
      address: requireContract(), abi: vitneraAbi, functionName: "updateDocumentRoot",
      args: [selected.id, prepared.root, metadataHash, uploaded.uri, roomKey.commitment],
    }));
    saveRoomKey(address, selected.id.toString(), nextVersion, roomKey.bytes);
    setReviewTexts((current) => ({ ...current, [selected.id.toString()]: prepared.texts }));
    await queryClient.invalidateQueries({ queryKey: ["rwa-rooms"] });
    setMessage(`Version ${nextVersion} published with a rotated room key. A new AI review is required.`);
  }

  async function runReview() {
    if (!selected || !tx.wallet) throw new Error("Select a room first");
    const texts = reviewTexts[selected.id.toString()];
    if (!texts?.length) throw new Error("Select and publish source documents in this session before review");
    const identityResponse = await fetch(`${appConfig.reviewerApi}/identity`);
    if (!identityResponse.ok) throw new Error("Reviewer identity service is unavailable");
    const identity = await identityResponse.json() as { reviewer: `0x${string}` };
    const nonce = await tx.client!.readContract({ address: requireContract(), abi: vitneraAbi, functionName: "reviewerNonces", args: [identity.reviewer] });
    const response = await fetch(`${appConfig.reviewerApi}/reviews`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        roomId: selected.id.toString(), roomVersion: Number(selected.version), documentRoot: selected.documentRoot,
        templateId: selected.templateId, reviewerNonce: nonce.toString(), expiry: Math.floor(Date.now() / 1000) + 7 * 86400,
        consent: { accepted: true, statementVersion: "review-consent-v1" }, documents: texts,
      }),
    });
    const signed = await response.json() as SignedReview & { error?: string };
    if (!response.ok) throw new Error(signed.error ?? "AI review failed");
    await tx.send(() => tx.wallet!.writeContract({
      address: requireContract(), abi: vitneraAbi, functionName: "recordAIReview",
      args: [{
        roomId: BigInt(signed.attestation.roomId),
        roomVersion: BigInt(signed.attestation.roomVersion),
        documentRoot: signed.attestation.documentRoot,
        templateId: signed.attestation.templateId,
        reviewStatus: signed.attestation.reviewStatus,
        riskFlagsHash: signed.attestation.riskFlagsHash,
        reportHash: signed.attestation.reportHash,
        policyVersion: REVIEW_POLICY_VERSION,
        nonce: BigInt(signed.attestation.nonce),
        expiry: BigInt(signed.attestation.expiry),
      }, signed.signature],
    }));
    setReviewResult(signed.report);
    await queryClient.invalidateQueries({ queryKey: ["rwa-rooms"] });
    setMessage(`AI review recorded: ${signed.report.reviewStatus}.`);
  }

  async function activate() {
    if (!selected || !tx.wallet) throw new Error("Select a room first");
    await tx.send(() => tx.wallet!.writeContract({ address: requireContract(), abi: vitneraAbi, functionName: "activateDataRoom", args: [selected.id] }));
    await queryClient.invalidateQueries({ queryKey: ["rwa-rooms"] });
    setMessage("Room activated. Investors can now escrow access requests.");
  }

  async function approveRequest(requestId: bigint, publicKey: Hex) {
    if (!selected || !address || !tx.wallet) throw new Error("Select a room first");
    const roomKey = loadRoomKey(address, selected.id.toString(), Number(selected.version));
    if (!roomKey) throw new Error("Import or restore this room version's key before approval");
    const request = requests.data?.find((item) => item.id === requestId);
    if (!request) throw new Error("Request not found");
    const envelope = await createKeyEnvelope({ roomKey, recipientPublicKey: hexToBytes(publicKey), roomId: selected.id.toString(), roomVersion: Number(selected.version), investor: request.investor, metadataUri: selected.metadataUri });
    const uploaded = await uploadJson(envelope, `vitnera-request-${requestId}-key-envelope.json`);
    const keyEnvelopeHash = await envelopeHash(envelope);
    await tx.send(() => tx.wallet!.writeContract({ address: requireContract(), abi: vitneraAbi, functionName: "approveAccess", args: [requestId, keyEnvelopeHash, uploaded.uri] }));
    await queryClient.invalidateQueries({ queryKey: ["room-requests", selected.id.toString()] });
    setMessage(`Request ${requestId} approved. Earnings are now claimable.`);
  }

  async function rejectRequest(requestId: bigint) {
    await tx.send(() => tx.wallet!.writeContract({ address: requireContract(), abi: vitneraAbi, functionName: "rejectAccess", args: [requestId] }));
    await queryClient.invalidateQueries({ queryKey: ["room-requests", selected?.id.toString()] });
  }

  async function exportKey() {
    if (!selected || !address) throw new Error("Select a room first");
    if (recoveryPassphrase.length < 12) throw new Error("Use a recovery passphrase with at least 12 characters");
    const roomKey = loadRoomKey(address, selected.id.toString(), Number(selected.version));
    if (!roomKey) throw new Error("This room key is not loaded in the current browser session");
    downloadJson(await exportRoomKeyRecovery({ roomKey, roomId: selected.id.toString(), roomVersion: Number(selected.version), passphrase: recoveryPassphrase }), `vitnera-room-${selected.id}-v${selected.version}-recovery.json`);
  }

  async function importRoomKey(file: File) {
    if (!selected || !address) throw new Error("Select a room first");
    const bundle = JSON.parse(await file.text()) as Parameters<typeof importRoomKeyRecovery>[0];
    if (bundle.roomId !== selected.id.toString() || bundle.roomVersion !== Number(selected.version)) {
      throw new Error("This recovery file belongs to another room version");
    }
    const roomKey = await importRoomKeyRecovery(bundle, recoveryPassphrase);
    if ((await sha256Hex(roomKey)) !== selected.keyCommitment) {
      throw new Error("Recovered key does not match the on-chain commitment");
    }
    saveRoomKey(address, selected.id.toString(), Number(selected.version), roomKey);
    setMessage("Room key restored for this browser session.");
  }

  async function withdraw() {
    await tx.send(() => tx.wallet!.writeContract({ address: requireContract(), abi: vitneraAbi, functionName: "withdrawEarnings" }));
    await earnings.refetch();
  }

  if (!address) return <div className="page empty-state"><h1>Issuer studio</h1><p>Connect a BOT Chain wallet to create and manage data rooms.</p></div>;

  return (
    <div className="page page-enter studio-page">
      <div className="page-heading split-heading"><div><p className="eyebrow">Issuer workspace</p><h1>Solar data-room studio</h1><p>Encrypt evidence, obtain an AI review, activate access, and settle approvals.</p></div><div className="earnings-card"><CircleDollarSign /><span>Claimable</span><strong>{formatEther(earnings.data ?? 0n)} BOT</strong><button disabled={!earnings.data || tx.pending} onClick={() => void withdraw().catch(() => undefined)}>Withdraw</button></div></div>
      <Notice error={tx.error} message={message} />
      {tx.hash && <a className="text-link" href={explorerTx(tx.hash)} target="_blank" rel="noreferrer">View latest transaction</a>}
      <section className="panel room-manager">
        <div className="section-title"><Archive /><div><p className="eyebrow">Portfolio</p><h2>Your data rooms</h2></div></div>
        <div className="room-tabs">{ownRooms.map((room) => <button key={room.id.toString()} className={selected?.id === room.id ? "active" : ""} onClick={() => setSelectedId(room.id.toString())}><strong>{room.metadata?.title ?? `Room ${room.id}`}</strong><span>{roomStatuses[room.status]} · v{room.version.toString()}</span></button>)}</div>
        {ownRooms.length === 0 && <p>No rooms yet. Publish your first encrypted solar data room below.</p>}
      </section>
      <div className="studio-grid">
        <section className="panel">
          <div className="section-title"><UploadCloud /><div><p className="eyebrow">Step 1</p><h2>Prepare encrypted evidence</h2></div></div>
          <label className="drop-zone"><input type="file" multiple onChange={(event) => chooseFiles(event.target.files)} /><UploadCloud /><strong>Select solar documents</strong><span>PDF, text, CSV, or JSON. Encryption occurs before upload.</span></label>
          <div className="draft-documents">{documents.map((document, index) => <div className="draft-row" key={document.id}><span>{document.file.name}</span><select value={document.type} onChange={(event) => setDocuments((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, type: event.target.value as DraftDocument["type"] } : item))}>{solarDocumentTypes.map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}</select></div>)}</div>
          {selected && <button className="button secondary wide" disabled={tx.pending || documents.length === 0} onClick={() => void publishNewVersion().catch(() => undefined)}><RefreshCw size={17} /> Publish as rotated version</button>}
        </section>
        <section className="panel">
          <div className="section-title"><FileKey /><div><p className="eyebrow">Step 2</p><h2>Create data room</h2></div></div>
          <label className="field"><span>Room title</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Kano Solar Lease Portfolio" /></label>
          <label className="field"><span>Public summary</span><textarea value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="Describe the asset without exposing protected evidence." /></label>
          <div className="field-pair"><label className="field"><span>Location</span><input value={location} onChange={(event) => setLocation(event.target.value)} /></label><label className="field"><span>Issuer name</span><input value={issuerName} onChange={(event) => setIssuerName(event.target.value)} /></label></div>
          <label className="field"><span>Access deposit (BOT)</span><input type="number" min="0.000001" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} /></label>
          <button className="button primary wide" disabled={tx.pending || documents.length === 0} onClick={() => void createRoom().catch(() => undefined)}>{tx.pending ? <Busy label="Publishing" /> : "Encrypt, upload, and create"}</button>
        </section>
        <section className="panel">
          <div className="section-title"><Bot /><div><p className="eyebrow">Step 3</p><h2>AI review and activation</h2></div></div>
          <p>Selected plaintext is disclosed only for this authorized review session. The signed result is bound to the current root and version.</p>
          {selected ? <div className="key-values"><span>Room<strong>{selected.id.toString()}</strong></span><span>Version<strong>{selected.version.toString()}</strong></span><span>State<strong>{roomStatuses[selected.status]}</strong></span></div> : <p>Select or create a room.</p>}
          {reviewResult && <div className="review-result"><Status tone={reviewResult.reviewStatus === "ReviewReady" ? "good" : "warn"}>{reviewResult.reviewStatus}</Status><p>{reviewResult.riskFlags.length} risk flags · {reviewResult.missingDocuments.length} missing documents</p></div>}
          <button className="button secondary wide" disabled={!selected || tx.pending} onClick={() => void runReview().catch(() => undefined)}>Run authorized AI review</button>
          <button className="button primary wide" disabled={!selected || tx.pending || selected.status === 1} onClick={() => void activate().catch(() => undefined)}>Activate ReviewReady room</button>
        </section>
        <section className="panel">
          <div className="section-title"><KeyRound /><div><p className="eyebrow">Recovery</p><h2>Back up room key</h2></div></div>
          <p>Raw keys stay in session memory. Export a passphrase-encrypted recovery file before closing this browser.</p>
          <label className="field"><span>Recovery passphrase</span><input type="password" value={recoveryPassphrase} onChange={(event) => setRecoveryPassphrase(event.target.value)} /></label>
          <button className="button secondary wide" disabled={!selected} onClick={() => void exportKey().catch((error) => setMessage(error.message))}>Export encrypted recovery</button>
          <label className="button secondary wide file-button"><KeyRound size={17} /> Restore encrypted recovery<input type="file" accept="application/json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importRoomKey(file).catch((error) => setMessage(error.message)); }} /></label>
        </section>
      </div>
      {selected && <section className="panel requests-panel"><div className="section-title"><CircleDollarSign /><div><p className="eyebrow">Escrow queue</p><h2>Investor access requests</h2></div></div>{requests.isLoading && <Busy label="Reading requests" />}{requests.data?.map((request) => <div className="request-row" key={request.id.toString()}><div><strong>Request #{request.id.toString()}</strong><span>{request.investor.slice(0, 8)}...{request.investor.slice(-6)} · {formatEther(request.amount)} BOT</span></div><Status tone={request.status === 1 ? "warn" : request.status === 2 ? "good" : "neutral"}>{requestStatuses[request.status]}</Status>{request.status === 1 && <div className="row-actions"><button onClick={() => void approveRequest(request.id, request.encryptionPublicKey).catch(() => undefined)}>Approve + envelope</button><button onClick={() => void rejectRequest(request.id).catch(() => undefined)}>Reject + refund</button></div>}</div>)}</section>}
    </div>
  );
}

async function extractReviewText(file: File): Promise<string> {
  if (file.type === "application/pdf") {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const content = await (await pdf.getPage(pageNumber)).getTextContent();
      pages.push(content.items.map((item) => "str" in item ? item.str : "").join(" "));
    }
    return pages.join("\n").slice(0, 200_000);
  }
  if (file.type.startsWith("text/") || ["application/json", "text/csv"].includes(file.type)) return (await file.text()).slice(0, 200_000);
  throw new Error(`${file.name} cannot be text-extracted for AI review yet. Use a text-based PDF, text, CSV, or JSON file.`);
}
