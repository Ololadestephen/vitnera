import { Menu, Moon, Sun, X } from "lucide-react";
import { useEffect, useState, type PropsWithChildren } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { WalletButton } from "./WalletButton";

const nav = [
  ["Explore", "/rooms"],
  ["My access", "/access"],
  ["Workspace", "/studio"],
  ["Security", "/security"],
  ["Technical proof", "/evidence"],
] as const;

export function Layout({ children }: PropsWithChildren) {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [dark, setDark] = useState(
    () => (localStorage.getItem("vitnera-theme") ?? localStorage.getItem("aegiskey-rwa-theme")) === "dark",
  );

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    localStorage.setItem("vitnera-theme", dark ? "dark" : "light");
  }, [dark]);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  return (
    <div className="site-shell">
      <header className={location.pathname === "/" ? "site-header landing-header" : "site-header"}>
        <NavLink className="brand" to="/" onClick={() => setMenuOpen(false)}>
          VITNERA <span>RWA INTELLIGENCE</span>
        </NavLink>
        <button className="menu-toggle" aria-label="Toggle menu" onClick={() => setMenuOpen(!menuOpen)}>
          {menuOpen ? <X /> : <Menu />}
        </button>
        <nav className={menuOpen ? "nav-links open" : "nav-links"}>
          {nav.map(([label, path]) => (
            <NavLink key={path} to={path} onClick={() => setMenuOpen(false)}>
              {label}
            </NavLink>
          ))}
          <button
            className="theme-button"
            aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
            onClick={() => setDark(!dark)}
          >
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <WalletButton />
        </nav>
      </header>
      <main>{children}</main>
      <footer className="site-footer">
        <div className="footer-main">
          <div className="footer-brand">
            <strong>VITNERA</strong>
            <p>Private evidence. Investable confidence.</p>
            <span>Confidential RWA diligence and wallet-bound access on BOT Chain.</span>
          </div>
          <div className="footer-links">
            <div className="footer-column">
              <strong>Product</strong>
              <NavLink to="/rooms">Explore rooms</NavLink>
              <NavLink to="/studio">Issuer workspace</NavLink>
              <NavLink to="/access">My access</NavLink>
            </div>
            <div className="footer-column">
              <strong>Resources</strong>
              <NavLink to="/evidence">Technical proof</NavLink>
              <NavLink to="/security">Security model</NavLink>
              <a href="https://github.com/Ololadestephen/vitnera" target="_blank" rel="noreferrer">GitHub</a>
              <a href="https://scan.botchain.ai" target="_blank" rel="noreferrer">BOT Chain explorer</a>
            </div>
            <div className="footer-column">
              <strong>Protocol</strong>
              <a href="https://scan.botchain.ai/address/0xc6a92F7E7BdDB2ca149518aE408006031808F117" target="_blank" rel="noreferrer">Verified contract</a>
              <NavLink to="/evidence">Evidence ledger</NavLink>
              <NavLink to="/rooms">Live testnet</NavLink>
            </div>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} Vitnera</span>
          <span>Plaintext documents and room keys never publish on-chain.</span>
        </div>
      </footer>
    </div>
  );
}
