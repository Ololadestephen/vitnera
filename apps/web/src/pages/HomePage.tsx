import {
  ArrowRight,
  Bot,
  Check,
  Database,
  EyeOff,
  FileKey2,
  FolderLock,
  Search,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { appConfig } from "../lib/config";

const consoleQueries = [
  "Solar portfolio · Room 08",
  "Equipment lease · Room 14",
  "Receivables pool · Room 21",
];
const registerQueries = [
  "Search private rooms...",
  "Northbank Solar Portfolio",
  "Ownership evidence · sealed",
];

function useTypewriter(phrases: string[]) {
  const [text, setText] = useState("");
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setText(phrases[0]);
      return;
    }
    let phrase = 0;
    let char = 0;
    let deleting = false;
    let timer: number;
    const tick = () => {
      const current = phrases[phrase];
      if (!deleting) {
        char += 1;
        setText(current.slice(0, char));
        if (char === current.length) {
          deleting = true;
          timer = window.setTimeout(tick, 2400);
          return;
        }
        timer = window.setTimeout(tick, 55 + Math.random() * 65);
        return;
      }
      char -= 1;
      setText(current.slice(0, char));
      if (char === 0) {
        deleting = false;
        phrase = (phrase + 1) % phrases.length;
        timer = window.setTimeout(tick, 520);
        return;
      }
      timer = window.setTimeout(tick, 26);
    };
    timer = window.setTimeout(tick, 700);
    return () => window.clearTimeout(timer);
  }, [phrases]);
  return text;
}

const lifecycle = [
  {
    number: "01",
    title: "Seal",
    label: "LOCAL ENCRYPTION",
    copy: "Documents are encrypted in the issuer's browser. Only ciphertext and integrity commitments leave the device.",
  },
  {
    number: "02",
    title: "Review",
    label: "AI EVIDENCE",
    copy: "The issuer explicitly selects evidence for a no-retention review session and receives structured findings.",
  },
  {
    number: "03",
    title: "Activate",
    label: "BOT CHAIN",
    copy: "A signed review is bound to the current document root before the room can accept investor requests.",
  },
  {
    number: "04",
    title: "Grant",
    label: "WALLET ACCESS",
    copy: "Approved investors receive a wallet-bound key envelope and decrypt the protected files locally.",
  },
];

export function HomePage() {
  const consoleText = useTypewriter(consoleQueries);
  const registerText = useTypewriter(registerQueries);
  return (
    <div className="home-page landing-page page-enter">
      <section className="landing-hero">
        <div className="landing-hero-copy">
          <p className="landing-badge"><span /> {appConfig.chainId === 677 ? "Live on BOT Chain" : "Live testnet product · BOT Chain"}</p>
          <h1>Private evidence,<br /><em>one verified path.</em></h1>
          <p className="landing-lead">
            Create encrypted RWA data rooms, run structured AI evidence review, and grant paid investor access
            without publishing plaintext documents or room keys.
          </p>
          <div className="landing-actions">
            <Link className="button primary" to="/rooms">Explore rooms <ArrowRight size={17} /></Link>
            <Link className="button secondary" to="/studio">Create a private room</Link>
          </div>
          <div className="landing-assurances" aria-label="Vitnera privacy assurances">
            <span><FolderLock size={15} /> Ciphertext storage</span>
            <span><Bot size={15} /> Consent-based AI</span>
            <span><WalletCards size={15} /> BOT escrow</span>
          </div>
        </div>

        <div className="landing-console-wrap" aria-label="Vitnera evidence workspace preview">
          <div className="landing-console">
            <div className="console-bar">
              <div><ShieldCheck size={18} /><strong>Evidence workspace</strong></div>
              <span>private by default</span>
            </div>
            <div className="console-search"><Search size={20} /><span>{consoleText}<span className="type-caret" /></span><kbd>esc</kbd></div>
            <div className="console-tabs">
              <button className="active"><FileKey2 size={18} /> Evidence</button>
              <button><Bot size={18} /> Review</button>
              <button><WalletCards size={18} /> Access</button>
            </div>
            <div className="console-room active">
              <div><span className="console-dot" /><strong>Review ready</strong><small>CURRENT VERSION</small></div>
              <p>6 encrypted files · root 0x82f1...c91a</p>
            </div>
            <div className="console-room">
              <div><span className="console-dot muted" /><strong>Ownership evidence</strong><small>ENCRYPTED</small></div>
              <p>Title record and equipment schedules sealed</p>
            </div>
            <div className="console-room">
              <div><span className="console-dot muted" /><strong>Investor access</strong><small>2 REQUESTS</small></div>
              <p>Deposits held in BOT Chain escrow</p>
            </div>
            <div className="console-footer">
              <span><EyeOff size={15} /> no public plaintext</span>
              <strong>document root verified</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-flow">
        <div className="landing-section-copy">
          <p className="landing-label">CONTROLLED LIFECYCLE</p>
          <h2>One room, not four separate handoffs.</h2>
          <p>
            Vitnera keeps evidence, review state, payment, and key delivery tied to the same room version.
            Every transition has one clear owner and one verifiable outcome.
          </p>
          <div className="root-stamp"><Database size={18} /><span>documentRoot</span><code>0x82f1...c91a</code></div>
        </div>

        <div className="lifecycle-panel">
          <div className="lifecycle-heading">
            <span>ACTIVE ROOM</span><strong>Evidence-to-access workflow</strong><small>version 04</small>
          </div>
          <div className="lifecycle-list">
            {lifecycle.map((step) => (
              <article key={step.number}>
                <span className="step-number">{step.number}</span>
                <div><strong>{step.title}</strong><p>{step.copy}</p></div>
                <small>{step.label}</small>
              </article>
            ))}
          </div>
          <div className="lifecycle-ready"><Check size={18} /><strong>Room ready for controlled investor access</strong></div>
        </div>
      </section>

      <section className="landing-library">
        <div className="library-copy">
          <p className="landing-label">PRIVATE ROOM REGISTER</p>
          <h2>Keep every asset version verifiable and private.</h2>
          <p>
            Manage room status, evidence completeness, access price, and investor requests without exposing the
            underlying documents in a public directory.
          </p>
          <ul>
            <li><Check /> Rotate the room key whenever evidence changes.</li>
            <li><Check /> Bind each AI review to its exact document root.</li>
            <li><Check /> Revoke future-version access without false erasure claims.</li>
          </ul>
          <Link className="text-link" to="/trust">See how it works <ArrowRight size={15} /></Link>
        </div>

        <div className="room-register" aria-label="Private room register preview">
          <div className="register-bar"><div><FolderLock size={18} /><strong>Private room register</strong></div><span>search · review · grant</span></div>
          <div className="register-body">
            <aside>
              <strong>Vitnera</strong>
              <button className="active">Asset rooms</button>
              <button>Access requests</button>
              <button>Evidence trail</button>
              <hr />
              <span>STATUS</span>
              <small>Review ready</small>
              <small>Draft</small>
            </aside>
            <div className="register-content">
              <div className="register-search"><Search size={19} /><span>{registerText}<span className="type-caret" /></span></div>
              <div className="register-room selected">
                <ShieldCheck /><div><strong>Northbank Solar Portfolio</strong><span>6 files · Review ready</span></div><small>0.50 BOT</small>
              </div>
              <div className="register-room">
                <FileKey2 /><div><strong>Equipment Lease 014</strong><span>4 files · Awaiting review</span></div><small>PRIVATE</small>
              </div>
              <div className="register-room">
                <Database /><div><strong>Receivables Pool Q3</strong><span>8 files · Draft</span></div><small>DRAFT</small>
              </div>
              <div className="register-metrics">
                <span><small>DOCUMENTS</small><strong>6 encrypted</strong></span>
                <span><small>REVIEW</small><strong>Root-bound</strong></span>
                <span><small>ACCESS</small><strong>Wallet-gated</strong></span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-final">
        <div>
          <p className="landing-label">PRIVATE BY DESIGN</p>
          <h2>Turn sensitive evidence into controlled investor access.</h2>
          <p>Start with one encrypted room. Keep plaintext, keys, and investor delivery under explicit control.</p>
          <div className="landing-actions">
            <Link className="button primary" to="/studio">Create a room <ArrowRight size={17} /></Link>
            <Link className="button secondary" to="/rooms">View live rooms</Link>
          </div>
        </div>
        <aside>
          <strong>Vitnera room standard</strong>
          <span><Check /> Local AES-GCM encryption</span>
          <span><Check /> Root-bound AI evidence review</span>
          <span><Check /> BOT Chain escrow settlement</span>
          <span><Check /> Wallet-bound key envelopes</span>
        </aside>
      </section>
    </div>
  );
}
