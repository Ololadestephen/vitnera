import { Menu, Moon, Sun, X } from "lucide-react";
import { useEffect, useState, type PropsWithChildren } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { WalletButton } from "./WalletButton";

const nav = [
  ["Explore", "/rooms"],
  ["My access", "/access"],
  ["Workspace", "/studio"],
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
          <button className="theme-button" onClick={() => setDark(!dark)}>
            {dark ? <Sun size={16} /> : <Moon size={16} />} {dark ? "Light" : "Dark"}
          </button>
          <WalletButton />
        </nav>
      </header>
      <main>{children}</main>
      <footer>
        <strong>VITNERA</strong>
        <span>Private evidence. Investable confidence.</span>
        <a href="https://github.com/Ololadestephen/Vitnera" target="_blank" rel="noreferrer">Open source</a>
      </footer>
    </div>
  );
}
