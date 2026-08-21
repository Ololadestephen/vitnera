import { useQuery } from "@tanstack/react-query";
import { Bot, Database, ExternalLink, EyeOff, Fingerprint, FileKey2, FolderLock, KeyRound, ShieldCheck, WalletCards } from "lucide-react";
import { usePublicClient } from "wagmi";
import { Busy } from "../components/Status";
import { vitneraAbi } from "../lib/contract";
import { appConfig, explorerTx, requireContract } from "../lib/config";

const eventNames = ["DataRoomCreated", "AIReviewRecorded", "VerifierAttestationRecorded", "DataRoomActivated", "AccessRequested", "AccessApproved", "AccessRejected", "RequestRefunded", "EarningsWithdrawn"] as const;

type EvidenceEvent = {
  eventName: string;
  transactionHash: `0x${string}`;
  blockNumber: bigint;
};

type EvidenceData =
  | { mode: "events"; events: EvidenceEvent[] }
  | { mode: "state"; blockNumber: bigint; roomCount: bigint; reviewCount: bigint; requestCount: bigint };

const stages = [
  {
    icon: <FolderLock size={20} />,
    title: "Encryption happens on your device",
    copy: "The issuer's browser generates a fresh AES-256-GCM room key and encrypts every evidence file before upload. IPFS stores ciphertext only — the storage provider never sees a filename's contents, a document byte, or the room key.",
  },
  {
    icon: <Database size={20} />,
    title: "Only commitments go on-chain",
    copy: "BOT Chain records hashes, not data: the metadata hash, the document Merkle root, and the room-key commitment. Anyone can verify that published metadata matches the chain without learning anything about the evidence.",
  },
  {
    icon: <Bot size={20} />,
    title: "AI review is explicit and consent-gated",
    copy: "Decrypted text is sent to the reviewer service only after the issuer ticks an informed-consent box. The reviewer returns structured findings and signs them with EIP-712; the signature is bound to the exact document root, so findings cannot be replayed against different evidence.",
  },
  {
    icon: <WalletCards size={20} />,
    title: "Access is wallet-bound",
    copy: "An investor generates an X25519 key pair locally and deposits the exact price into contract escrow. Approval seals the room key into an envelope decryptable only by that investor's private key. Rejected or expired requests refund automatically.",
  },
];

const threats = [
  {
    risk: "Storage provider reads your documents",
    answer: "Cannot. It only ever receives AES-256-GCM ciphertext. Integrity is enforced because the contract stores the ciphertext Merkle root, so swapped or truncated files fail verification before decryption.",
  },
  {
    risk: "Another investor gets your key envelope",
    answer: "Useless to them. Each envelope is sealed to one investor public key with ephemeral X25519 key agreement. Opening it with any other private key fails cryptographically.",
  },
  {
    risk: "Issuer publishes misleading evidence after review",
    answer: "Detectable. The signed AI review is bound to a document root on-chain. Publishing new evidence rotates the room key and invalidates the previous root, forcing a fresh review.",
  },
  {
    risk: "Issuer loses their browser session",
    answer: "Recoverable without a central custodian. The room key is sealed to a passphrase-encrypted creator recovery identity whose kit the issuer downloads and stores offline.",
  },
  {
    risk: "Someone tampers with public metadata",
    answer: "Verifiable. Every client re-hashes fetched metadata and compares it with the hash recorded at room creation before trusting a single field of it.",
  },
  {
    risk: "The AI provider retains confidential text",
    answer: "Disclosed and optional. Reviews run only with explicit issuer consent, and the consent statement is versioned. No review is required to keep a room in draft forever.",
  },
];

export function TrustCenterPage() {
  const client = usePublicClient();
  const evidence = useQuery({
    queryKey: ["rwa-evidence", client?.chain.id], enabled: Boolean(client),
    queryFn: async (): Promise<EvidenceData> => {
      if (appConfig.eventLogsSupported) {
        try {
          const batches = await Promise.all(eventNames.map((eventName) => client!.getContractEvents({ address: requireContract(), abi: vitneraAbi, eventName, fromBlock: appConfig.deploymentBlock, toBlock: "latest" })));
          const events = batches.flatMap((batch) => batch.flatMap((event) => (
            event.transactionHash && event.blockNumber
              ? [{ eventName: event.eventName, transactionHash: event.transactionHash, blockNumber: event.blockNumber }]
              : []
          ))).sort((a, b) => Number(b.blockNumber - a.blockNumber));
          return { mode: "events", events };
        } catch {
          // The public BOT mainnet RPC does not expose historical event logs.
        }
      }

      const contract = requireContract();
      const [roomCount, reviewCount, requestCount, blockNumber] = await Promise.all([
        client!.readContract({ address: contract, abi: vitneraAbi, functionName: "roomCount" }),
        client!.readContract({ address: contract, abi: vitneraAbi, functionName: "reviewCount" }),
        client!.readContract({ address: contract, abi: vitneraAbi, functionName: "requestCount" }),
        client!.getBlockNumber(),
      ]);
      return { mode: "state", roomCount, reviewCount, requestCount, blockNumber };
    },
  });

  const stateRows = evidence.data?.mode === "state" ? [
    ["Data rooms", evidence.data.roomCount],
    ["AI reviews", evidence.data.reviewCount],
    ["Access requests", evidence.data.requestCount],
  ] as const : [];

  return (
    <div className="page page-enter">
      <div className="page-heading split-heading">
        <div>
          <p className="eyebrow">Threat model</p>
          <h1>Trust Center</h1>
          <p>
            Vitnera is built so that every party — including us — sees the minimum needed at each step.
            Here is exactly what is protected, from whom, how you can verify it, and the live on-chain proof.
          </p>
        </div>
        <div className="chain-stamp"><ShieldCheck /> Zero plaintext exposure</div>
      </div>

      <section className="security-grid">
        {stages.map((stage) => (
          <article className="panel security-stage" key={stage.title}>
            <span className="security-icon">{stage.icon}</span>
            <h2>{stage.title}</h2>
            <p>{stage.copy}</p>
          </article>
        ))}
      </section>

      <section className="panel threat-panel">
        <div className="section-title"><EyeOff /><div><p className="eyebrow">Attack scenarios</p><h2>What happens when something goes wrong</h2></div></div>
        <div className="threat-list">
          {threats.map((item) => (
            <article key={item.risk}>
              <strong>{item.risk}</strong>
              <p>{item.answer}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="section-title"><FileKey2 /><div><p className="eyebrow">Verify it yourself</p><h2>Independent checks anyone can run</h2></div></div>
        <ul className="verify-list">
          <li><KeyRound size={16} /> Open browser devtools during room creation: uploads contain ciphertext blobs only.</li>
          <li><Database size={16} /> Compare the metadata hash on BOT Chain with the IPFS metadata file for any room.</li>
          <li><ShieldCheck size={16} /> Read the verified contract source on the explorer — no plaintext or key material appears in any event.</li>
          <li><WalletCards size={16} /> Check escrow flows: deposits move only between investor, contract, and issuer wallets.</li>
        </ul>
      </section>

      <section className="panel evidence-list trust-ledger">
        <div className="section-title"><Fingerprint /><div><p className="eyebrow">On-chain evidence</p><h2>{evidence.data?.mode === "state" ? "Live contract state" : "Live contract events"}</h2></div></div>
        <p className="trust-ledger-note">
          {evidence.data?.mode === "state"
            ? `Read directly at BOT Chain block ${evidence.data.blockNumber.toString()}. This RPC does not expose historical logs, so Vitnera shows current contract counters instead of inventing an event history.`
            : "Read directly from BOT Chain. No private files or room keys appear here."}
        </p>
        {evidence.isLoading && <Busy label="Reading on-chain evidence" />}
        {evidence.isError && <div className="empty-state">On-chain evidence is temporarily unavailable. Try another BOT Chain RPC.</div>}
        {evidence.data?.mode === "events" && evidence.data.events.map((event, index) => <a key={`${event.transactionHash}-${index}`} href={explorerTx(event.transactionHash)} target="_blank" rel="noreferrer" className="evidence-row"><Fingerprint /><div><strong>{event.eventName}</strong><span>Block {event.blockNumber.toString()} · {event.transactionHash.slice(0, 12)}...{event.transactionHash.slice(-8)}</span></div><ExternalLink /></a>)}
        {stateRows.map(([label, value]) => <div className="evidence-row" key={label}><Fingerprint /><div><strong>{label}</strong><span>{value.toString()} recorded on the current contract</span></div></div>)}
        {!evidence.isLoading && evidence.data?.mode === "events" && evidence.data.events.length === 0 && <div className="empty-state">No contract evidence yet.</div>}
      </section>
    </div>
  );
}
