import { useQuery } from "@tanstack/react-query";
import { Bot, Database, ExternalLink, EyeOff, Fingerprint, FileKey2, FolderLock, KeyRound, ShieldCheck, WalletCards } from "lucide-react";
import { usePublicClient } from "wagmi";
import { Busy } from "../components/Status";
import { vitneraAbi } from "../lib/contract";
import { appConfig, explorerTx, requireContract } from "../lib/config";

const eventNames = ["DataRoomCreated", "AIReviewRecorded", "VerifierAttestationRecorded", "DataRoomActivated", "AccessRequested", "AccessApproved", "AccessRejected", "RequestRefunded", "EarningsWithdrawn"] as const;

const issuerSteps = [
  {
    title: "Add your evidence",
    copy: "Upload the documents a serious investor would expect: an asset overview, proof of ownership or control, and valuation or financial evidence. Files are classified locally so the public listing only shows categories, never contents.",
  },
  {
    title: "Encrypt in your browser",
    copy: "Vitnera generates a fresh AES-256-GCM room key and encrypts every file before anything leaves your device. Only ciphertext is uploaded to IPFS. The room key never touches a server.",
  },
  {
    title: "Anchor commitments on-chain",
    copy: "BOT Chain stores hashes, not data: the metadata hash, a Merkle root of all ciphertext, and a commitment to the room key. Anyone can later prove that published files were not swapped or truncated.",
  },
  {
    title: "Run an AI review (optional)",
    copy: "With your explicit consent, extracted text is sent to the reviewer service. It returns structured findings and signs them with EIP-712, bound to the exact document root, so findings cannot be replayed against different evidence.",
  },
  {
    title: "Publish and get paid",
    copy: "You make the separate decision to publish. Investors deposit the exact price into contract escrow; you approve requests by sealing the room key to each investor's public key. Earnings are withdrawable at any time.",
  },
];

const investorSteps = [
  {
    title: "Inspect before you pay",
    copy: "Each listing shows public facts: asset type, location, evidence categories, price, and review status. Protected files stay encrypted until you are approved.",
  },
  {
    title: "Deposit into escrow",
    copy: "Generate an X25519 key pair locally and deposit the exact price into the contract. Your funds are held by BOT Chain escrow, not by Vitnera.",
  },
  {
    title: "Receive wallet-bound keys",
    copy: "On approval the room key is sealed into an envelope only your private key can open. Rejected or expired deposits are refundable through the contract.",
  },
  {
    title: "Decrypt locally",
    copy: "Download the ciphertext, verify it against the on-chain Merkle root, and decrypt in your browser. Documents are never re-hosted by Vitnera.",
  },
];

const faqs = [
  {
    q: "Can Vitnera read my documents?",
    a: "No. Encryption and decryption happen entirely in your browser using a key generated on your device. Servers only ever store ciphertext, and the contract stores hashes. There is no admin backdoor by construction.",
  },
  {
    q: "What happens if I lose my browser session?",
    a: "Issuers set up a passphrase-encrypted creator recovery identity once. Its recovery kit downloads as a file you store offline, and it can re-seal any future room version's key. No central custodian involved.",
  },
  {
    q: "Does the AI see everything?",
    a: "Only if you consent, per room version. The review sends extracted text to the configured provider, receives structured findings, and records their signature on-chain bound to the document root. You can publish without ever running a review, but active rooms require a recorded one.",
  },
  {
    q: "What does ERC-3643 verification add?",
    a: "Optionally, an issuer links a room to an ERC-3643 token. The contract then resolves that token's Identity Registry live and rejects deposits from unverified wallets. The check runs again at approval, before any key is released. General rooms remain available for any wallet.",
  },
  {
    q: "Can the issuer change the rules after I deposit?",
    a: "No. Access price, terms, and the linked compliance asset are fixed per room version. Publishing new evidence rotates the room key and requires a fresh AI review; existing approvals are unaffected, and pending requests can always be refunded.",
  },
  {
    q: "What stops the issuer from swapping files after a review?",
    a: "Every document set has a Merkle root recorded on-chain and bound into the signed AI review. New evidence produces a new root, which invalidates the old review. Clients verify ciphertext against the root before decrypting.",
  },
  {
    q: "How do refunds work?",
    a: "Three paths, all enforced by the contract: the issuer rejects a request, the request expires after its TTL, or the room becomes unavailable. Refunds are claimable directly from the contract, no support ticket required.",
  },
  {
    q: "Is this financial advice?",
    a: "No. The AI review checks evidence completeness, consistency, and freshness. It explicitly does not judge whether an asset is a good investment, and rooms published with unresolved warnings carry an on-chain acknowledgement saying so.",
  },
];

export function HowItWorksPage() {
  const client = usePublicClient();
  const evidence = useQuery({
    queryKey: ["rwa-evidence", client?.chain.id], enabled: Boolean(client),
    queryFn: async () => {
      const batches = await Promise.all(eventNames.map((eventName) => client!.getContractEvents({ address: requireContract(), abi: vitneraAbi, eventName, fromBlock: appConfig.deploymentBlock, toBlock: "latest" })));
      return batches.flat().sort((a, b) => Number((b.blockNumber ?? 0n) - (a.blockNumber ?? 0n)));
    },
  });

  return (
    <div className="page page-enter">
      <div className="page-heading split-heading">
        <div>
          <p className="eyebrow">How Vitnera works</p>
          <h1>Private diligence,<br />verifiable access</h1>
          <p>
            Vitnera connects two things that rarely meet: confidential real-world-asset evidence
            and on-chain investor eligibility. Issuers encrypt documents locally and publish
            verifiable data rooms. Investors deposit into contract escrow and receive
            wallet-bound decryption keys. Nobody in the middle, including us, can read what
            is sold or verify what should not be sold.
          </p>
        </div>
        <div className="chain-stamp"><ShieldCheck /> Zero plaintext exposure</div>
      </div>

      <section className="how-grid">
        <article className="panel how-flow">
          <div className="section-title"><FolderLock /><div><p className="eyebrow">For issuers</p><h2>From raw evidence to a paid data room</h2></div></div>
          <ol className="how-steps">{issuerSteps.map((step, index) => (
            <li key={step.title}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{step.title}</strong><p>{step.copy}</p></div></li>
          ))}</ol>
        </article>
        <article className="panel how-flow">
          <div className="section-title"><WalletCards /><div><p className="eyebrow">For investors</p><h2>From public facts to decrypted files</h2></div></div>
          <ol className="how-steps">{investorSteps.map((step, index) => (
            <li key={step.title}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{step.title}</strong><p>{step.copy}</p></div></li>
          ))}</ol>
          <div className="root-stamp"><Database size={18} /><span>documentRoot</span><code>bound to every signed review</code></div>
        </article>
      </section>

      <section className="security-grid">
        <article className="panel security-stage">
          <span className="security-icon"><FolderLock size={20} /></span>
          <h2>What is stored where</h2>
          <p>IPFS holds ciphertext blobs and integrity-hashed metadata. BOT Chain holds commitments: metadata hash, ciphertext Merkle root, room-key commitment, review signatures, and escrow balances. Browsers hold keys: session-scoped and recoverable via the offline creator kit.</p>
        </article>
        <article className="panel security-stage">
          <span className="security-icon"><Bot size={20} /></span>
          <h2>What the AI can and cannot do</h2>
          <p>The reviewer checks whether required evidence exists, is current, and is internally consistent. It flags risks as structured findings signed with EIP-712. It cannot approve an asset's value, cannot see files you never submit for review, and cannot alter what is on-chain.</p>
        </article>
        <article className="panel security-stage">
          <span className="security-icon"><ShieldCheck size={20} /></span>
          <h2>Optional ERC-3643 gating</h2>
          <p>Link a room to an ERC-3643 asset and only wallets verified by that asset's Identity Registry can deposit. The rule is enforced on-chain at deposit and again at key release. Eligibility comes from BOT Chain's official registry, not from Vitnera.</p>
        </article>
        <article className="panel security-stage">
          <span className="security-icon"><KeyRound size={20} /></span>
          <h2>Key rotation on every version</h2>
          <p>Publishing updated evidence mints a fresh room key. Old envelopes stop working for future versions without pretending past access can be erased. Revocation stays honest, scoped to what cryptography can actually enforce.</p>
        </article>
      </section>

      <section className="panel threat-panel">
        <div className="section-title"><EyeOff /><div><p className="eyebrow">Security model</p><h2>What happens when something goes wrong</h2></div></div>
        <div className="threat-list">
          <article><strong>A storage provider tries to read the documents</strong><p>It only ever received AES-256-GCM ciphertext. The contract stores the ciphertext Merkle root, so swapped or truncated files fail verification before decryption is even attempted.</p></article>
          <article><strong>Someone intercepts an investor's key envelope</strong><p>Useless without that investor's private key. Each envelope is sealed with ephemeral X25519 key agreement to exactly one recipient public key.</p></article>
          <article><strong>Verification lapses after an investor deposits</strong><p>On regulated rooms, approval resolves the registry again and refuses to release the key. The deposit stays recoverable, since rejection and expiry paths never depend on verification status.</p></article>
          <article><strong>The issuer loses their browser</strong><p>The room key is sealed to a passphrase-encrypted creator recovery identity whose kit lives offline. One kit recovers every future room version.</p></article>
          <article><strong>Public metadata is tampered with</strong><p>Every client re-hashes fetched metadata and compares it with the hash recorded at creation before trusting a single field.</p></article>
          <article><strong>The AI provider retains confidential text</strong><p>Reviews are opt-in per room version with a versioned consent statement, and no review is needed while a room stays in draft.</p></article>
        </div>
      </section>

      <section className="panel faq-panel">
        <div className="section-title"><FileKey2 /><div><p className="eyebrow">FAQ</p><h2>Frequently asked questions</h2></div></div>
        <div className="faq-list">
          {faqs.map((item) => (
            <details key={item.q}>
              <summary>{item.q}</summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="panel evidence-list trust-ledger">
        <div className="section-title"><Fingerprint /><div><p className="eyebrow">On-chain evidence</p><h2>Live contract events</h2></div></div>
        <p className="trust-ledger-note">Read directly from BOT Chain. No private files or room keys appear here.</p>
        {evidence.isLoading && <Busy label="Reading contract events" />}
        {evidence.data?.map((event, index) => <a key={`${event.transactionHash}-${index}`} href={explorerTx(event.transactionHash)} target="_blank" rel="noreferrer" className="evidence-row"><Fingerprint /><div><strong>{event.eventName}</strong><span>Block {event.blockNumber?.toString()} · {event.transactionHash.slice(0, 12)}...{event.transactionHash.slice(-8)}</span></div><ExternalLink /></a>)}
        {!evidence.isLoading && evidence.data?.length === 0 && <div className="empty-state">No contract evidence yet.</div>}
      </section>
    </div>
  );
}
