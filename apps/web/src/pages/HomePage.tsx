import { ArrowRight, Bot, FileCheck2, KeyRound, Landmark, LockKeyhole, ScanSearch } from "lucide-react";
import { Link } from "react-router-dom";

export function HomePage() {
  return (
    <div className="home-page page-enter">
      <section className="hero-panel">
        <img className="hero-image" src="/images/vitnera-solar-dawn.jpg" alt="" aria-hidden="true" />
        <div className="hero-shade" />
        <div className="hero-content">
          <div className="hero-kicker"><span /> Confidential RWA intelligence</div>
          <h1>Private evidence.<br /><em>Investable confidence.</em></h1>
          <p>
            Encrypted asset data rooms where AI review, investor approval, and BOT settlement meet.
          </p>
          <div className="hero-actions">
            <Link className="button hero-primary" to="/rooms">Explore data rooms <ArrowRight size={17} /></Link>
            <Link className="button hero-secondary" to="/studio">Issue an asset room</Link>
          </div>
        </div>
        <aside className="hero-evidence" aria-label="Platform assurances">
          <div className="evidence-heading"><ScanSearch size={16} /><span>Evidence protocol</span><strong>LIVE</strong></div>
          <dl>
            <div><dt>Storage</dt><dd>Ciphertext only</dd></div>
            <div><dt>Activation</dt><dd>AI review gated</dd></div>
            <div><dt>Settlement</dt><dd>BOT escrow</dd></div>
          </dl>
        </aside>
        <div className="hero-index" aria-hidden="true">01 / SOLAR ASSETS</div>
      </section>

      <section className="home-thesis">
        <div className="thesis-copy">
          <p className="eyebrow"><LockKeyhole size={15} /> Built for evidence, not speculation</p>
          <h2>The room opens only when the evidence holds.</h2>
          <p>
            Vitnera gives issuers a controlled way to share sensitive asset documents and gives investors
            a verifiable path from review to access.
          </p>
          <Link className="text-link home-link" to="/evidence">See the public evidence trail <ArrowRight size={15} /></Link>
        </div>
        <div className="proof-sequence" aria-label="How Vitnera works">
          <article>
            <span>01</span><FileCheck2 />
            <div><strong>Seal the evidence</strong><p>Documents are encrypted locally before storage.</p></div>
          </article>
          <article>
            <span>02</span><Bot />
            <div><strong>Review before activation</strong><p>Structured AI findings are bound to the document root.</p></div>
          </article>
          <article>
            <span>03</span><Landmark />
            <div><strong>Approve and settle</strong><p>BOT escrow and wallet-bound keys control investor access.</p></div>
          </article>
        </div>
      </section>

      <section className="home-closing">
        <KeyRound />
        <p>Documents stay encrypted in storage. Approved investors decrypt locally.</p>
        <Link to="/studio">Create a private room <ArrowRight size={15} /></Link>
      </section>
    </div>
  );
}
