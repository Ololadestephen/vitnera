import {
  RWA_BASIC_TEMPLATE_ID,
  REVIEW_POLICY_VERSION,
  bytesToBase64,
  createCreatorRoomKeyEnvelope,
  decryptDocument,
  documentMerkleRoot,
  encryptDocument,
  exportRoomKeyRecovery,
  generatePrivatePublicSummary,
  generateRoomKey,
  hashCanonical,
  importRoomKeyRecovery,
  openCreatorRoomKeyEnvelope,
  rwaAssetTypes,
  rwaDocumentTypes,
  sha256Hex,
  type AIReviewReport,
  type RwaAssetType,
  type RwaManifest,
} from "@vitnera/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Bot, CircleDollarSign, FileKey, KeyRound, RefreshCw, UploadCloud } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { decodeEventLog, formatEther, keccak256, parseEther, toBytes, type Hex } from "viem";
import { useAccount } from "wagmi";
import { Busy, Notice, Status } from "../components/Status";
import { useRooms } from "../hooks/useRooms";
import { useTransaction } from "../hooks/useTransaction";
import { useCreatorRecovery } from "../hooks/useCreatorRecovery";
import { useRoomLifecycle } from "../hooks/useRoomLifecycle";
import { useAccessRequests } from "../hooks/useAccessRequests";
import { reviewStatuses, vitneraAbi, requestStatuses, roomStatuses } from "../lib/contract";
import { appConfig, explorerTx, requireContract } from "../lib/config";
import {
  downloadJson,
  loadRoomKey,
  saveRoomKey,
} from "../lib/session";
import { fetchVerifiedBytes, uploadEncryptedBlob, uploadJson } from "../lib/storage";
import type { DraftDocument, PublicRoomMetadata } from "../lib/types";

const evidenceCategoryHint = "Classify each file with its dropdown. The AI review expects asset overview, ownership or control, and valuation or financial evidence.";

const assetTypeLabels: Record<RwaAssetType, string> = {
  equipment: "Equipment",
  real_estate: "Real estate",
  commodities: "Commodities",
  receivables: "Receivables",
  other: "Other asset",
};

const reviewStatusLabels = {
  ReviewReady: "Ready",
  NeedsReview: "Attention needed",
  Incomplete: "Incomplete",
} as const;

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
  const [assetType, setAssetType] = useState<RwaAssetType>("other");
  const [price, setPrice] = useState("0.05");
  const [message, setMessage] = useState<string>();
  const [actionError, setActionError] = useState<unknown>();
  const [progress, setProgress] = useState<string>();
  const [reviewResult, setReviewResult] = useState<AIReviewReport>();
  const [acknowledgeFindings, setAcknowledgeFindings] = useState(false);
  const [reviewConsent, setReviewConsent] = useState(false);

  const ownRooms = useMemo(() => (rooms.data ?? []).filter((room) => room.issuer.toLowerCase() === address?.toLowerCase()), [rooms.data, address]);
  const {
    creatorRecovery,
    creatorRecoveryPassphrase,
    setCreatorRecoveryPassphrase,
    legacyRecoveryPassphrase,
    setLegacyRecoveryPassphrase,
    requiresExistingCreatorRecovery,
    setupIdentity,
    importKit: importCreatorKit,
    exportKit: exportCreatorKit,
  } = useCreatorRecovery({ address, ownRooms, notify: setMessage });
  const selected = ownRooms.find((room) => room.id.toString() === selectedId) ?? ownRooms[0];
  const [selectedHasKey, setSelectedHasKey] = useState(false);
  const refreshKeyState = useCallback(() => {
    setSelectedHasKey(Boolean(selected && address && loadRoomKey(address, selected.id.toString(), Number(selected.version))));
  }, [selected, address]);
  useEffect(() => {
    refreshKeyState();
  }, [refreshKeyState]);
  const currentReview = useQuery({
    queryKey: ["current-room-review", selected?.currentReviewId.toString()],
    enabled: Boolean(tx.client && selected && selected.currentReviewId > 0n),
    queryFn: () => tx.client!.readContract({
      address: requireContract(), abi: vitneraAbi, functionName: "getReview", args: [selected!.currentReviewId],
    }),
  });
  const earnings = useQuery({
    queryKey: ["issuer-earnings", address], enabled: Boolean(tx.client && address),
    queryFn: () => tx.client!.readContract({ address: requireContract(), abi: vitneraAbi, functionName: "claimableEarnings", args: [address!] }),
  });

  function chooseFiles(files: FileList | null) {
    if (!files) return;
    setSummary("");
    setDocuments(Array.from(files).map((file) => ({
      id: crypto.randomUUID(), file,
      type: "supporting_document" as DraftDocument["type"],
      required: false,
    })));
  }

  function generatePublicSummary() {
    setSummary(generatePrivatePublicSummary({
      title,
      assetType,
      assetLocation: location,
      evidenceTypes: documents.map((document) => document.type),
      evidenceCount: documents.length,
    }));
    setMessage("Public summary generated locally. No document content left this browser.");
  }

  function selectRoom(roomId: string) {
    setSelectedId(roomId);
    setReviewResult(undefined);
    setActionError(undefined);
    setMessage(undefined);
    setAcknowledgeFindings(false);
    setReviewConsent(false);
  }

  async function prepareVersion(roomId: string, version: number, roomKey: Uint8Array) {
    if (!address || documents.length === 0) throw new Error("Select at least one source document");
    const encryptedDocuments: RwaManifest["documents"] = [];
    setProgress("Checking that every document can be reviewed...");
    const texts: ReviewText[] = await Promise.all(documents.map(async (item) => ({
      id: item.id,
      type: item.type,
      displayName: item.file.name,
      text: await extractReviewText(item.file),
    })));
    for (const [index, item] of documents.entries()) {
      setProgress(`Encrypting and uploading document ${index + 1} of ${documents.length}...`);
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
    }
    const manifest: RwaManifest = {
      templateId: RWA_BASIC_TEMPLATE_ID, assetId: roomId, roomId, version,
      generatedAt: new Date().toISOString(), documents: encryptedDocuments,
    };
    return { manifest, texts, root: await documentMerkleRoot(manifest) };
  }

  async function createRoom() {
    if (!tx.wallet || !address) throw new Error("Connect an issuer wallet first");
    if (!title.trim() || !summary.trim()) throw new Error("Add a title and generate the public summary first");
    if (!creatorRecovery) throw new Error("Set up or import your creator recovery identity first");
    if (parseEther(price) <= 0n) throw new Error("Access deposit must be greater than zero");
    const roomKey = await generateRoomKey();
    const draftId = crypto.randomUUID();
    const prepared = await prepareVersion(draftId, 1, roomKey.bytes);
    const creatorRecoveryEnvelope = await createCreatorRoomKeyEnvelope({
      roomKey: roomKey.bytes,
      recoveryPublicKey: creatorRecovery.publicKey,
      assetId: draftId,
      roomVersion: 1,
      keyCommitment: roomKey.commitment,
    });
    const metadata: PublicRoomMetadata = {
      format: "vitnera-rwa-room-v3",
      title: title.trim(),
      summary: summary.trim(),
      assetLocation: location.trim(),
      issuerDisplayName: `${address.slice(0, 6)}...${address.slice(-4)}`,
      assetType,
      manifest: prepared.manifest,
      creatorRecoveryEnvelope,
    };
    const metadataHash = await hashCanonical(metadata);
    setProgress("Uploading encrypted room metadata...");
    const metadataUpload = await uploadJson(metadata, `vitnera-${draftId}-metadata.json`);
    const termsHash = await hashCanonical({ price, requestTtl: 172800, settlement: "issuer-on-approval" });
    setProgress("Waiting for wallet approval...");
    const receipt = await tx.send(() => tx.wallet!.writeContract({
      address: requireContract(), abi: vitneraAbi, functionName: "createDataRoom",
      args: [metadataHash, metadataUpload.uri, prepared.root, roomKey.commitment, termsHash,
        keccak256(toBytes(RWA_BASIC_TEMPLATE_ID)), parseEther(price), 172800n],
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
    setMessage(`Data room ${created} created. Its rotated key is recoverable with your creator recovery kit.`);
  }

  async function runAction(action: () => Promise<void>) {
    setActionError(undefined);
    setMessage(undefined);
    try {
      await action();
    } catch (error) {
      setActionError(error);
    } finally {
      setProgress(undefined);
      refreshKeyState();
    }
  }

  async function publishNewVersion() {
    if (!selected || !tx.wallet || !address) throw new Error("Select one of your rooms");
    if (!creatorRecovery) throw new Error("Import your creator recovery kit before publishing a new version");
    const nextVersion = Number(selected.version) + 1;
    const roomKey = await generateRoomKey();
    const assetId = selected.metadata?.manifest.assetId ?? selected.id.toString();
    const prepared = await prepareVersion(assetId, nextVersion, roomKey.bytes);
    const creatorRecoveryEnvelope = await createCreatorRoomKeyEnvelope({
      roomKey: roomKey.bytes,
      recoveryPublicKey: creatorRecovery.publicKey,
      assetId,
      roomVersion: nextVersion,
      keyCommitment: roomKey.commitment,
    });
    const metadata: PublicRoomMetadata = {
      ...(selected.metadata ?? {
        format: "vitnera-rwa-room-v3",
        title: title.trim(),
        summary: summary.trim(),
        assetLocation: location.trim(),
        issuerDisplayName: `${address.slice(0, 6)}...${address.slice(-4)}`,
        assetType,
      }),
      format: "vitnera-rwa-room-v3",
      manifest: prepared.manifest,
      creatorRecoveryEnvelope,
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
    if (!selected || !tx.wallet || !address) throw new Error("Select a room first");
    if (selected.status === 3) throw new Error("Archived rooms cannot be reviewed or reopened");
    let texts = reviewTexts[selected.id.toString()];
    if (!texts?.length) texts = await rebuildReviewText(selected.id.toString());
    setProgress("Starting the authorized AI review...");
    const identityResponse = await fetch(`${appConfig.reviewerApi}/identity`);
    if (!identityResponse.ok) throw new Error("Reviewer identity service is unavailable");
    const identity = await identityResponse.json() as { reviewer: `0x${string}` };
    const nonce = await tx.client!.readContract({ address: requireContract(), abi: vitneraAbi, functionName: "reviewerNonces", args: [identity.reviewer] });
    setProgress("Reviewing the selected evidence...");
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
    const attestation = {
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
    } as const;
    setProgress("Recording the signed AI findings on BOT Chain...");
    await tx.send(() => tx.wallet!.writeContract({
      address: requireContract(), abi: vitneraAbi, functionName: "recordAIReview",
      args: [attestation, signed.signature],
    }));
    setReviewResult(signed.report);
    await queryClient.invalidateQueries({ queryKey: ["rwa-rooms"] });
    setAcknowledgeFindings(false);
    setReviewConsent(false);
    setMessage(`AI review recorded: ${reviewStatusLabels[signed.report.reviewStatus]}. The issuer must now make the separate publish decision.`);
  }

  async function publishReviewedRoom() {
    if (!selected || !tx.wallet || !address) throw new Error("Select a room first");
    if (selected.status !== 0 || selected.currentReviewId === 0n || !currentReview.data) {
      throw new Error("Record a current signed AI review before publishing");
    }
    if (Number(currentReview.data.expiry) * 1000 <= Date.now()) throw new Error("This AI review has expired. Run a fresh review first");
    const status = Number(currentReview.data.status);
    if (status === 1) {
      await tx.send(() => tx.wallet!.writeContract({
        address: requireContract(), abi: vitneraAbi, functionName: "activateDataRoom", args: [selected.id],
      }));
    } else {
      if (!acknowledgeFindings) throw new Error("Acknowledge the unresolved AI findings before publishing");
      const acknowledgementHash = await hashCanonical({
        action: "issuer-publish-with-ai-findings-v1",
        issuer: address,
        roomId: selected.id.toString(),
        roomVersion: selected.version.toString(),
        reviewId: selected.currentReviewId.toString(),
        reportHash: currentReview.data.reportHash,
      });
      await tx.send(() => tx.wallet!.writeContract({
        address: requireContract(), abi: vitneraAbi, functionName: "activateDataRoomWithAcknowledgement",
        args: [selected.id, acknowledgementHash],
      }));
    }
    await queryClient.invalidateQueries({ queryKey: ["rwa-rooms"] });
    setAcknowledgeFindings(false);
    setMessage(status === 1 ? "Room published by the issuer after reviewing the AI report." : "Room published with an on-chain issuer acknowledgement of unresolved AI findings.");
  }

  async function rebuildReviewText(roomId: string): Promise<ReviewText[]> {
    if (!selected || selected.id.toString() !== roomId || !address) throw new Error("Select the room first");
    if (!selected.metadata) throw new Error("The encrypted room metadata is not available yet");
    let roomKey = loadRoomKey(address, roomId, Number(selected.version));
    if (!roomKey && selected.metadata.creatorRecoveryEnvelope && creatorRecovery) {
      roomKey = await recoverRoomKeyFromCreatorIdentity(selected.metadata.creatorRecoveryEnvelope);
    }
    if (!roomKey) throw new Error("Import your creator recovery kit before continuing the review");
    setProgress("Loading and decrypting the room evidence locally...");
    const texts = await Promise.all(selected.metadata.manifest.documents.map(async (document) => {
      const ciphertext = await fetchVerifiedBytes(document.ciphertextUri, document.ciphertextHash);
      const plaintext = await decryptDocument({
        ciphertext,
        roomKey,
        iv: document.iv,
        associatedData: document.associatedData,
      });
      return {
        id: document.id,
        type: document.type,
        displayName: document.displayName,
        text: await extractReviewBytes(plaintext, document.mimeType, document.displayName),
      };
    }));
    setReviewTexts((current) => ({ ...current, [roomId]: texts }));
    return texts;
  }

  async function resolveRoomKeyForApproval(): Promise<Uint8Array> {
    if (!selected || !address) throw new Error("Select a room first");
    let roomKey = loadRoomKey(address, selected.id.toString(), Number(selected.version));
    if (!roomKey && selected.metadata?.creatorRecoveryEnvelope && creatorRecovery) {
      roomKey = await recoverRoomKeyFromCreatorIdentity(selected.metadata.creatorRecoveryEnvelope);
    }
    if (!roomKey) throw new Error("Import your creator recovery kit before approval");
    return roomKey;
  }

  const { requests, approveRequest, rejectRequest } = useAccessRequests({
    tx, selected, resolveRoomKey: resolveRoomKeyForApproval, notify: setMessage,
  });
  const { pauseRoom, resumeRoom, archiveRoom } = useRoomLifecycle({ tx, selected, notify: setMessage });

  async function exportKey() {
    if (!selected || !address) throw new Error("Select a room first");
    if (legacyRecoveryPassphrase.length < 12) throw new Error("Use a recovery passphrase with at least 12 characters");
    const roomKey = loadRoomKey(address, selected.id.toString(), Number(selected.version));
    if (!roomKey) throw new Error("This room key is not loaded in the current browser session");
    downloadJson(await exportRoomKeyRecovery({ roomKey, roomId: selected.id.toString(), roomVersion: Number(selected.version), passphrase: legacyRecoveryPassphrase }), `vitnera-room-${selected.id}-v${selected.version}-recovery.json`);
  }

  async function importRoomKey(file: File) {
    if (!selected || !address) throw new Error("Select a room first");
    const bundle = JSON.parse(await file.text()) as Parameters<typeof importRoomKeyRecovery>[0];
    if (bundle.roomId !== selected.id.toString() || bundle.roomVersion !== Number(selected.version)) {
      throw new Error("This recovery file belongs to another room version");
    }
    const roomKey = await importRoomKeyRecovery(bundle, legacyRecoveryPassphrase);
    if ((await sha256Hex(roomKey)) !== selected.keyCommitment) {
      throw new Error("Recovered key does not match the on-chain commitment");
    }
    saveRoomKey(address, selected.id.toString(), Number(selected.version), roomKey);
    setMessage("Room key restored for this browser session.");
  }

  async function recoverRoomKeyFromCreatorIdentity(
    envelope: NonNullable<PublicRoomMetadata["creatorRecoveryEnvelope"]>,
  ): Promise<Uint8Array> {
    if (!selected || !address || !creatorRecovery) throw new Error("Import your creator recovery kit first");
    if (envelope.roomVersion !== Number(selected.version)) throw new Error("Recovery envelope version mismatch");
    if (envelope.keyCommitment !== selected.keyCommitment) throw new Error("Recovery envelope commitment mismatch");
    const roomKey = await openCreatorRoomKeyEnvelope(envelope, creatorRecovery.privateKey);
    saveRoomKey(address, selected.id.toString(), Number(selected.version), roomKey);
    return roomKey;
  }

  async function recoverSelectedRoom() {
    if (!selected?.metadata?.creatorRecoveryEnvelope) {
      throw new Error("This legacy room needs its original per-room recovery backup");
    }
    await recoverRoomKeyFromCreatorIdentity(selected.metadata.creatorRecoveryEnvelope);
    setMessage("Room key recovered and loaded for this browser session.");
  }

  async function withdraw() {
    await tx.send(() => tx.wallet!.writeContract({ address: requireContract(), abi: vitneraAbi, functionName: "withdrawEarnings" }));
    await earnings.refetch();
  }

  if (!address) return <div className="page empty-state"><h1>Issuer workspace</h1><p>Connect a BOT Chain wallet to create and manage private asset rooms.</p></div>;

  return (
    <div className="page page-enter studio-page">
      <div className="page-heading split-heading"><div><p className="eyebrow">Issuer workspace</p><h1>Publish a private asset room</h1><p>Add evidence, create the encrypted room, then review and publish.</p></div><div className="earnings-card"><CircleDollarSign /><span>Claimable</span><strong>{formatEther(earnings.data ?? 0n)} BOT</strong><button disabled={!earnings.data || tx.pending} onClick={() => void runAction(withdraw)}>Withdraw</button></div></div>
      <Notice error={actionError ?? tx.error} message={progress ?? message} />
      {tx.hash && <a className="text-link" href={explorerTx(tx.hash)} target="_blank" rel="noreferrer">View latest transaction</a>}
      <section className="panel room-manager">
        <div className="section-title"><Archive /><div><p className="eyebrow">Your rooms</p><h2>Manage asset rooms</h2></div></div>
        <div className="room-tabs">{ownRooms.map((room) => <button key={room.id.toString()} className={selected?.id === room.id ? "active" : ""} onClick={() => selectRoom(room.id.toString())}><strong>{room.metadata?.title ?? `Room ${room.id}`}</strong><span>{roomStatuses[room.status]} · v{room.version.toString()}</span></button>)}</div>
        {ownRooms.length === 0 && <p>No rooms yet. Create your first encrypted asset room below.</p>}
        {selected && <div className="selected-room-manager"><div><p className="eyebrow">Selected room</p><h3>{selected.metadata?.title ?? `Room ${selected.id}`}</h3><p>{selected.status === 0 ? "Evidence is encrypted and registered. Record an AI report in Step 3, then make the separate issuer publish decision." : selected.status === 1 ? "This room is open and accepting protected access requests." : selected.status === 2 ? "New requests are paused. You can reopen it while the current review remains valid." : "This room is archived and retained as immutable history."}</p><span className={`room-key-state ${selectedHasKey ? "ready" : "missing"}`}>{selectedHasKey ? "Room key available" : "Room key missing in this browser"}</span></div><div className="room-management-actions">{selected.status === 1 && <button className="button secondary" disabled={tx.pending} onClick={() => void runAction(pauseRoom)}>Pause requests</button>}{selected.status === 2 && <button className="button primary" disabled={tx.pending} onClick={() => void runAction(resumeRoom)}>Resume requests</button>}<Link className="button secondary" to={`/rooms/${selected.id}`}>View room</Link>{selected.status !== 3 && <button className="button danger" disabled={tx.pending} onClick={() => void runAction(archiveRoom)}>Archive</button>}</div></div>}
        {selected && !selectedHasKey && selected.status !== 3 && selected.metadata?.creatorRecoveryEnvelope && <div className="selected-room-recovery"><div><strong>Recover this room</strong><p>This version is sealed to your creator recovery identity. The recovered key stays in this browser session only.</p></div>{creatorRecovery ? <button className="button primary" disabled={tx.pending || Boolean(progress)} onClick={() => void runAction(recoverSelectedRoom)}><KeyRound size={17} /> Recover room key</button> : <><label className="field compact-field"><span>Creator recovery passphrase</span><input type="password" value={creatorRecoveryPassphrase} onChange={(event) => setCreatorRecoveryPassphrase(event.target.value)} placeholder="12+ characters" /></label><label className="button secondary file-button"><KeyRound size={17} /> Import creator kit<input type="file" accept="application/json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void runAction(() => importCreatorKit(file)); }} /></label></>}</div>}
        {selected && !selectedHasKey && selected.status !== 3 && !selected.metadata?.creatorRecoveryEnvelope && <div className="selected-room-recovery"><div><strong>Legacy room recovery</strong><p>This older room predates creator recovery. Restore its original per-room backup or publish the evidence as a new encrypted version.</p></div><label className="field compact-field"><span>Legacy backup passphrase</span><input type="password" value={legacyRecoveryPassphrase} onChange={(event) => setLegacyRecoveryPassphrase(event.target.value)} placeholder="12+ characters" /></label><label className="button secondary file-button"><KeyRound size={17} /> Restore legacy backup<input type="file" accept="application/json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void runAction(() => importRoomKey(file)); }} /></label><button className="button primary" disabled={documents.length === 0 || !creatorRecovery || tx.pending || Boolean(progress)} onClick={() => void runAction(publishNewVersion)}><RefreshCw size={17} /> Replace as new version</button></div>}
      </section>
      <div className="studio-grid">
        <section className="panel">
          <div className="section-title"><UploadCloud /><div><p className="eyebrow">Step 1</p><h2>Add asset evidence</h2></div></div>
          <p>Add evidence covering the asset, ownership or control, and valuation or finances. One comprehensive dossier can cover all three. Files are encrypted before upload.</p>
          <label className="drop-zone"><input type="file" multiple onChange={(event) => chooseFiles(event.target.files)} /><UploadCloud /><strong>Select evidence files</strong><span>Text-based PDF, text, CSV, or JSON.</span></label>
          <div className="draft-documents">{documents.map((document, index) => <div className="draft-row" key={document.id}><span>{document.file.name}</span><select value={document.type} onChange={(event) => { setSummary(""); setDocuments((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, type: event.target.value as DraftDocument["type"], required: event.target.value !== "supporting_document" } : item)); }}>{rwaDocumentTypes.map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}</select></div>)}{documents.length > 0 && <p className="privacy-note">{evidenceCategoryHint}</p>}</div>
        </section>
        <section className="panel">
          <div className="section-title"><FileKey /><div><p className="eyebrow">Step 2</p><h2>Create the room</h2></div></div>
          <div className={`creator-recovery-card ${creatorRecovery ? "ready" : "missing"}`}>
            <div><span>Creator recovery</span><strong>{creatorRecovery ? "Ready for this session" : requiresExistingCreatorRecovery ? "Import your existing kit" : "One-time setup required"}</strong>{creatorRecovery && <small>{bytesToBase64(creatorRecovery.publicKey).slice(0, 18)}...</small>}</div>
            {!creatorRecovery && <><label className="field compact-field"><span>Recovery passphrase</span><input type="password" value={creatorRecoveryPassphrase} onChange={(event) => setCreatorRecoveryPassphrase(event.target.value)} placeholder="12+ characters" /></label><div className="recovery-actions">{!requiresExistingCreatorRecovery && <button className="button primary small" disabled={creatorRecoveryPassphrase.length < 12} onClick={() => void runAction(setupIdentity)}>Create and download kit</button>}<label className="button secondary small file-button">Import existing kit<input type="file" accept="application/json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void runAction(() => importCreatorKit(file)); }} /></label></div></>}
          </div>
          <label className="field"><span>Room title</span><input value={title} onChange={(event) => { setTitle(event.target.value); setSummary(""); }} placeholder="Equipment evidence room" /></label>
          <div className="private-summary-field"><div><span>Public summary</span><small>Generated locally from public labels only</small></div>{summary ? <p>{summary}</p> : <p className="summary-placeholder">Generate a safe marketplace summary after adding a title and evidence.</p>}<button className="button secondary small" disabled={!title.trim() || documents.length === 0} onClick={generatePublicSummary}>{summary ? "Regenerate summary" : "Generate private summary"}</button></div>
          <label className="field"><span>Access deposit (BOT)</span><input type="number" min="0.000001" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} /></label>
          <details className="room-optional-details"><summary>Optional asset details</summary><label className="field"><span>Asset type</span><select value={assetType} onChange={(event) => { setAssetType(event.target.value as RwaAssetType); setSummary(""); }}>{rwaAssetTypes.map((type) => <option key={type} value={type}>{assetTypeLabels[type]}</option>)}</select></label><label className="field"><span>Broad location</span><input value={location} onChange={(event) => { setLocation(event.target.value); setSummary(""); }} placeholder="Optional, for example West Africa" /></label></details>
          <button className="button primary wide" disabled={tx.pending || Boolean(progress) || documents.length === 0 || !creatorRecovery || !summary.trim()} onClick={() => void runAction(createRoom)}>{tx.pending || progress ? <Busy label={progress ?? "Creating"} /> : "Encrypt, upload, and create draft"}</button>
          {documents.length === 0 && <p className="privacy-note">Add the evidence files in Step 1 to continue.</p>}
        </section>
        <section className="panel review-publish-panel">
          <div className="section-title"><Bot /><div><p className="eyebrow">Step 3</p><h2>Review and publish</h2></div></div>
          <p>Vitnera checks whether required evidence is present, current, and internally consistent. Commercial risks remain visible but do not block publication.</p>
          {selected ? <div className="key-values"><span>Room<strong>{selected.id.toString()}</strong></span><span>Version<strong>{selected.version.toString()}</strong></span><span>State<strong>{roomStatuses[selected.status]}</strong></span></div> : <p>Select or create a room.</p>}
          {currentReview.data && <div className="signed-review-state"><div><span>Current signed review</span><strong>{reviewStatuses[Number(currentReview.data.status)]}</strong></div><div><span>Issuer decision</span><strong>{selected?.status === 1 ? "Published" : "Pending"}</strong></div><div><span>Expires</span><strong>{new Date(Number(currentReview.data.expiry) * 1000).toLocaleDateString()}</strong></div></div>}
          {reviewResult && <div className="review-result"><div className="review-result-heading"><Status tone={reviewResult.reviewStatus === "ReviewReady" ? "good" : "warn"}>{reviewStatusLabels[reviewResult.reviewStatus]}</Status><span>{reviewResult.blockingIssues.length} blockers · {reviewResult.riskFlags.length} observations · {reviewResult.missingDocuments.length} missing</span></div><h3>AI evidence summary</h3><p>{reviewResult.executiveSummary}</p>{reviewResult.blockingIssues.length > 0 && <><h3>Issuer attention required</h3><ul className="blocking-list">{reviewResult.blockingIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul></>}{reviewResult.keyFindings.length > 0 && <ul>{reviewResult.keyFindings.map((finding) => <li key={finding}>{finding}</li>)}</ul>}<button className="button secondary" onClick={() => downloadJson(reviewResult, `vitnera-room-${selected?.id ?? "draft"}-ai-review.json`)}>Download AI review</button></div>}
          {selected && selected.status !== 3 && <label className="review-consent"><input type="checkbox" checked={reviewConsent} onChange={(event) => setReviewConsent(event.target.checked)} /><span>I authorize this room's decrypted evidence text to be sent to the configured AI provider for this review. Provider retention and abuse-monitoring policies may apply.</span></label>}
          <button className="button secondary wide" disabled={!selected || selected.status === 3 || !reviewConsent || tx.pending || Boolean(progress)} onClick={() => void runAction(runReview)}>{tx.pending || progress ? <Busy label={progress ?? "Reviewing"} /> : "Run AI evidence review"}</button>
          {selected?.status === 0 && currentReview.data && Number(currentReview.data.status) !== 1 && <label className="issuer-acknowledgement"><input type="checkbox" checked={acknowledgeFindings} onChange={(event) => setAcknowledgeFindings(event.target.checked)} /><span>I reviewed the AI findings and accept responsibility for publishing this room with unresolved evidence warnings.</span></label>}
          {selected?.status === 0 && currentReview.data && <button className="button primary wide" disabled={tx.pending || Boolean(progress) || (Number(currentReview.data.status) !== 1 && !acknowledgeFindings)} onClick={() => void runAction(publishReviewedRoom)}>{Number(currentReview.data.status) === 1 ? "Publish reviewed room" : "Publish with acknowledged findings"}</button>}
        </section>
      </div>
      <details className="panel advanced-panel">
        <summary><KeyRound size={18} /> Recovery and document versions</summary>
        <div className="advanced-content">
          <p>One creator kit recovers every new room version. Each version still receives a fresh room key.</p>
          {selected && <button className="button secondary wide" disabled={tx.pending || documents.length === 0 || !creatorRecovery} onClick={() => void runAction(publishNewVersion)}><RefreshCw size={17} /> Publish selected files as a new version</button>}
          <label className="field"><span>Creator recovery passphrase</span><input type="password" value={creatorRecoveryPassphrase} onChange={(event) => setCreatorRecoveryPassphrase(event.target.value)} placeholder="Required to export or import the kit" /></label>
          <button className="button secondary wide" disabled={!creatorRecovery || creatorRecoveryPassphrase.length < 12} onClick={() => void runAction(exportCreatorKit)}>Download a fresh creator recovery kit</button>
          <label className="button secondary wide file-button"><KeyRound size={17} /> Import creator recovery kit<input type="file" accept="application/json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void runAction(() => importCreatorKit(file)); }} /></label>
          <details className="legacy-recovery"><summary>Legacy per-room backup</summary><p>Only use this for rooms created before creator recovery was introduced.</p><label className="field"><span>Legacy backup passphrase</span><input type="password" value={legacyRecoveryPassphrase} onChange={(event) => setLegacyRecoveryPassphrase(event.target.value)} /></label><button className="button secondary wide" disabled={!selected} onClick={() => void runAction(exportKey)}>Export legacy room backup</button><label className="button secondary wide file-button"><KeyRound size={17} /> Restore legacy room backup<input type="file" accept="application/json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void runAction(() => importRoomKey(file)); }} /></label></details>
        </div>
      </details>
      {selected && <section className="panel requests-panel"><div className="section-title"><CircleDollarSign /><div><p className="eyebrow">Access requests</p><h2>Approve or refund investors</h2></div></div>{requests.isLoading && <Busy label="Reading requests" />}{requests.data?.map((request) => <div className="request-row" key={request.id.toString()}><div><strong>Request #{request.id.toString()}</strong><span>{request.investor.slice(0, 8)}...{request.investor.slice(-6)} · {formatEther(request.amount)} BOT</span></div><Status tone={request.status === 1 ? "warn" : request.status === 2 ? "good" : "neutral"}>{requestStatuses[request.status]}</Status>{request.status === 1 && <div className="row-actions"><button onClick={() => void runAction(() => approveRequest(request.id, request.encryptionPublicKey))}>Approve access</button><button onClick={() => void runAction(() => rejectRequest(request.id))}>Reject & refund</button></div>}</div>)}</section>}
    </div>
  );
}

async function extractReviewText(file: File): Promise<string> {
  return extractReviewBytes(new Uint8Array(await file.arrayBuffer()), file.type, file.name);
}

async function extractReviewBytes(bytes: Uint8Array, mimeType: string, displayName: string): Promise<string> {
  if (mimeType === "application/pdf") {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
    const pdf = await pdfjs.getDocument({ data: bytes.slice() }).promise;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const content = await (await pdf.getPage(pageNumber)).getTextContent();
      pages.push(content.items.map((item) => "str" in item ? item.str : "").join(" "));
    }
    return requireReadableText(pages.join("\n"), displayName);
  }
  if (mimeType.startsWith("text/") || ["application/json", "text/csv"].includes(mimeType)) return requireReadableText(new TextDecoder().decode(bytes), displayName);
  throw new Error(`${displayName} cannot be text-extracted for AI review yet. Use a text-based PDF, text, CSV, or JSON file.`);
}

function requireReadableText(value: string, displayName: string): string {
  const text = value.replace(/\s+/gu, " ").trim().slice(0, 200_000);
  if (text.length < 20) throw new Error(`${displayName} has no readable text. Run OCR or use a text-based PDF, TXT, CSV, or JSON file.`);
  return text;
}
