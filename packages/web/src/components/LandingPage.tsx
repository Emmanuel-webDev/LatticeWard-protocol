import { useEffect, useRef, useState } from "react";
import { formatEther, formatUnits } from "ethers";
import type { VaultSnapshot } from "../lib/chain";
import { REFERENCE_VAULT_ADDRESS, explorerAddrUrl, explorerTxUrl } from "../lib/constants";

interface Props {
  referenceVault: VaultSnapshot | null;
  onOpenApp: () => void;
}

const DRILL_CHECKS = [
  {
    id: "1",
    scenario: "Valid agent payout inside daily limit",
    outcome: "Succeeded",
    tx: "0xf176d24256d812af43b035a4eb4655156a3aadddcbd7f0332a9e170d8e69bfcc",
  },
  {
    id: "2",
    scenario: "Over-spend (10x per-payment limit)",
    outcome: "Blocked (ExceedsScopedMaxTxValue)",
    tx: "0xc1c7521c78a041ff91a0cdda0347cafb1568b1606f34d40a287b28a68ab5d654",
  },
  {
    id: "3",
    scenario: "Send to non-quantum-safe address (0x0A02)",
    outcome: "Blocked (RecipientNotQuantumSafe)",
    tx: "0xaee3adacd0ae5f5e530cb39552f3a820ef397318ae6af040585e546959e8bf33",
  },
  {
    id: "4a",
    scenario: "Leaked key tries to rewrite policy (0x0A01)",
    outcome: "Blocked (InvalidMLDSASignature)",
    tx: "0xc5ea37991d81a18b2af9b25ab59247df9abd3d5a33bab6d923ccbccc56f64a52",
  },
  {
    id: "4b",
    scenario: "Leaked key tries sovereign withdrawal (0x0A01)",
    outcome: "Blocked (InvalidMLDSASignature)",
    tx: "0xd475f3fce24190e0bd949e90058a98f7b7c4878300bd8bc23f5791d27f368f6b",
  },
  {
    id: "5",
    scenario: "Replay of an already executed payment",
    outcome: "Blocked (IntentAlreadyUsed)",
    tx: null,
  },
  {
    id: "6a",
    scenario: "ML-DSA-87 emergency freeze & key revocation",
    outcome: "Frozen + Agent Revoked",
    tx: "0x16dac29907d06ffbd1567392e0ab9c98e1d4f6661afa537a0470ed56b5edf9e0",
  },
  {
    id: "6b",
    scenario: "ML-DSA-87 recovery (unfreeze vault)",
    outcome: "Active",
    tx: "0x8c53a3db12e00cc51ed291e188c64b0f2b00d1a5f772bee757caa32fb74ea7da",
  },
];

const FAQS = [
  {
    q: "What happens if my AI agent's hot key is leaked?",
    a: "The agent key can only spend up to your per-payment and daily limits, and only to quantum-safe recipients when the 0x0A02 firewall is on. It cannot change rules, raise limits, or withdraw your treasury.",
  },
  {
    q: "Why do I need both QoreX and MetaMask?",
    a: "QoreX manages your post-quantum identity and opens your EVM authorization window on QoreChain's native lane. MetaMask signs standard EVM transactions such as creating a vault or depositing funds.",
  },
  {
    q: "Where is my Lattice key stored?",
    a: "Your ML-DSA-87 Lattice key is generated randomly in your browser, encrypted with your passphrase (PBKDF2 + AES-GCM), and stored locally in IndexedDB. You must download and confirm an encrypted backup file before creating your first vault.",
  },
  {
    q: "What does 'daily limit' mean?",
    a: "Your daily limit caps total spending over a 24-hour window. The day starts at the first payment.",
  },
];

export function LandingPage({ referenceVault, onOpenApp }: Props) {
  const [activePlane, setActivePlane] = useState<1 | 2>(1);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const plane1Ref = useRef<HTMLDivElement | null>(null);
  const plane2Ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced || typeof IntersectionObserver === "undefined") return;

    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            if (entry.target === plane1Ref.current) setActivePlane(1);
            if (entry.target === plane2Ref.current) setActivePlane(2);
          }
        }
      },
      { threshold: 0.55 },
    );

    if (plane1Ref.current) obs.observe(plane1Ref.current);
    if (plane2Ref.current) obs.observe(plane2Ref.current);
    return () => obs.disconnect();
  }, []);

  return (
    <div className="landing-wrap">
      {/* 1. Hero */}
      <section className="hero-section" aria-labelledby="hero-heading">
        <div className="eyebrow">QoreChain Diana Testnet · Chain ID 9800 · Testnet Prototype</div>
        <h1 id="hero-heading" className="hero-title hero-reveal">
          Agents spend. Quantum can&apos;t steal.
        </h1>
        <p className="hero-sub">
          LatticeWard splits your AI agent&apos;s hot spending key from your post-quantum Lattice key so a leaked
          classical key or Q-Day cannot drain funds in your vault.
        </p>
        <div className="row-wrap">
          <button type="button" className="btn btn-primary" onClick={onOpenApp}>
            Open the app
          </button>
          <a className="btn" href="#live-proof">
            See the live proof
          </a>
        </div>

        {/* Live strip of real reference vault facts */}
        <div style={{ marginTop: 40 }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>
            Live Public Reference Vault ({REFERENCE_VAULT_ADDRESS.slice(0, 8)}...{REFERENCE_VAULT_ADDRESS.slice(-6)}) ·
            Shared Demo (Not Your Personal Vault)
          </div>
          <div className="live-strip" style={{ marginTop: 0 }} aria-label="Live public reference vault state on QoreChain Diana">
            <div className="live-cell">
              <div className="eyebrow">Demo Vault State</div>
              <div style={{ marginTop: 8 }}>
                {referenceVault ? (
                  <span className={`badge ${referenceVault.frozen ? "badge-danger" : "badge-safe"}`}>
                    {referenceVault.frozen ? "❄ Frozen" : "● Active"}
                  </span>
                ) : (
                  <span className="muted">Reading chain...</span>
                )}
              </div>
            </div>
            <div className="live-cell">
              <div className="eyebrow">Demo QOR Balance</div>
              <div className="big-metric tabular" style={{ marginTop: 4 }}>
                {referenceVault ? `${Number(formatEther(referenceVault.qorBalance)).toFixed(3)} QOR` : "—"}
              </div>
            </div>
            <div className="live-cell">
              <div className="eyebrow">Demo ERC-20 fUSD</div>
              <div className="big-metric tabular" style={{ marginTop: 4 }}>
                {referenceVault
                  ? `${Number(formatUnits(referenceVault.fusdBalance, referenceVault.fusdDecimals)).toFixed(1)} fUSD`
                  : "—"}
              </div>
            </div>
            <div className="live-cell">
              <div className="eyebrow">Demo QOR Daily Limit</div>
              <div className="big-metric tabular" style={{ marginTop: 4 }}>
                {referenceVault ? `${formatEther(referenceVault.qorLimit.epochLimit)} QOR` : "—"}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 2. Two Planes Explainer (Sticky Scroll + Hairline Diagram) */}
      <section className="planes-section" aria-labelledby="planes-heading">
        <div className="eyebrow">Architecture</div>
        <h2 id="planes-heading" style={{ fontSize: "clamp(1.75rem, 4vw, 2.5rem)", margin: "8px 0 24px" }}>
          Two planes of authority.
        </h2>

        <div className="planes-grid">
          <div>
            <div ref={plane1Ref} className={`plane-step ${activePlane === 1 ? "is-active" : ""}`}>
              <div className="eyebrow">Plane 1 · Execution</div>
              <h3 style={{ marginTop: 8 }}>Disposable classical agent key</h3>
              <p className="muted">
                Your AI agent signs routine payouts with a hot <code>secp256k1</code> key. Every payout is bounded
                on-chain by a per-payment cap, a rolling daily limit, an asset allowlist, replay protection, and the{" "}
                <code>0x0A02</code> quantum-safety recipient firewall.
              </p>
              <button type="button" className="btn" onClick={() => setActivePlane(1)}>
                Inspect Plane 1
              </button>
            </div>

            <div ref={plane2Ref} className={`plane-step ${activePlane === 2 ? "is-active" : ""}`}>
              <div className="eyebrow">Plane 2 · Sovereign</div>
              <h3 style={{ marginTop: 8 }}>Post-quantum ML-DSA-87 control</h3>
              <p className="muted">
                Changing limits, rotating keys, freezing the vault, or withdrawing treasury funds requires a 4,627-byte
                ML-DSA-87 signature verified on-chain by precompile <code>0x0A01</code>. There is no{" "}
                <code>ecrecover</code> and no <code>onlyOwner</code>.
              </p>
              <button type="button" className="btn" onClick={() => setActivePlane(2)}>
                Inspect Plane 2
              </button>
            </div>
          </div>

          <div className="planes-sticky card" aria-live="polite">
            <div className="eyebrow">
              {activePlane === 1 ? "Active Diagram · Plane 1 (Scoped Spend)" : "Active Diagram · Plane 2 (Sovereign ML-DSA-87)"}
            </div>
            <svg
              viewBox="0 0 420 260"
              width="100%"
              role="img"
              aria-label={
                activePlane === 1
                  ? "Diagram showing disposable agent key constrained by daily limits and 0x0A02 firewall"
                  : "Diagram showing sovereign ML-DSA-87 key verified by 0x0A01 precompile controlling vault policy"
              }
              style={{ marginTop: 16, display: "block" }}
            >
              <rect
                x="16"
                y="20"
                width="170"
                height="64"
                rx="6"
                fill="none"
                stroke={activePlane === 1 ? "var(--accent)" : "var(--line-strong)"}
                strokeWidth="1.5"
              />
              <text x="30" y="46" fill="var(--text)" fontSize="12" fontWeight="600">
                Agent Key (secp256k1)
              </text>
              <text x="30" y="66" fill="var(--text-muted)" fontSize="11">
                Hot · Disposable · Scoped
              </text>

              <rect
                x="16"
                y="168"
                width="170"
                height="64"
                rx="6"
                fill="none"
                stroke={activePlane === 2 ? "var(--accent)" : "var(--line-strong)"}
                strokeWidth="1.5"
              />
              <text x="30" y="194" fill="var(--text)" fontSize="12" fontWeight="600">
                Lattice Key (ML-DSA-87)
              </text>
              <text x="30" y="214" fill="var(--text-muted)" fontSize="11">
                Sovereign · FIPS 204 · 4,627 B
              </text>

              <line
                x1="186"
                y1="52"
                x2="244"
                y2="110"
                stroke={activePlane === 1 ? "var(--accent)" : "var(--line-strong)"}
                strokeWidth="1.5"
              />
              <line
                x1="186"
                y1="200"
                x2="244"
                y2="145"
                stroke={activePlane === 2 ? "var(--accent)" : "var(--line-strong)"}
                strokeWidth="1.5"
              />

              <rect
                x="244"
                y="62"
                width="160"
                height="136"
                rx="6"
                fill="none"
                stroke="var(--text)"
                strokeWidth="1.5"
              />
              <text x="258" y="90" fill="var(--text)" fontSize="13" fontWeight="700">
                LatticeWardVault
              </text>
              <text x="258" y="116" fill="var(--text-muted)" fontSize="11">
                {activePlane === 1 ? "• Daily limit + per-tx cap" : "• 0x0A01 pqcVerify"}
              </text>
              <text x="258" y="138" fill="var(--text-muted)" fontSize="11">
                {activePlane === 1 ? "• 0x0A02 recipient check" : "• Freeze / Unfreeze"}
              </text>
              <text x="258" y="160" fill="var(--text-muted)" fontSize="11">
                {activePlane === 1 ? "• Replay-safe intents" : "• No ecrecover / onlyOwner"}
              </text>
            </svg>
          </div>
        </div>
      </section>

      {/* 3. Live Proof Table */}
      <section id="live-proof" className="proof-section" aria-labelledby="proof-heading">
        <div className="row-wrap" style={{ justifyContent: "space-between", marginBottom: 16 }}>
          <div>
            <div className="eyebrow">On-Chain Verification</div>
            <h2 id="proof-heading" style={{ fontSize: "clamp(1.5rem, 3.5vw, 2.25rem)", margin: "6px 0 0" }}>
              Live Q-Day Breach Drill (8/8 Passed)
            </h2>
          </div>
          <a className="btn" href={explorerAddrUrl(REFERENCE_VAULT_ADDRESS)} target="_blank" rel="noreferrer">
            Inspect Drilled Vault
          </a>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table className="hairline-table">
            <thead>
              <tr>
                <th>Check</th>
                <th>Scenario</th>
                <th>On-Chain Result</th>
                <th>Transaction</th>
              </tr>
            </thead>
            <tbody>
              {DRILL_CHECKS.map((c) => (
                <tr key={c.id} className="hairline-row">
                  <td className="tabular">
                    <strong>{c.id}</strong>
                  </td>
                  <td>{c.scenario}</td>
                  <td>
                    <span className="badge badge-safe">✓ {c.outcome}</span>
                  </td>
                  <td>
                    {c.tx ? (
                      <a href={explorerTxUrl(c.tx)} target="_blank" rel="noreferrer" className="mono">
                        {c.tx.slice(0, 10)}...{c.tx.slice(-6)}
                      </a>
                    ) : (
                      <span className="muted">staticCall verified</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 4. How It Works (4 Steps) + FAQ + Honest Status + Footer */}
      <section className="steps-section" aria-labelledby="how-heading">
        <div className="eyebrow">Workflow</div>
        <h2 id="how-heading" style={{ fontSize: "clamp(1.5rem, 3.5vw, 2.25rem)", margin: "6px 0 24px" }}>
          How it works in 4 steps
        </h2>
        <div className="grid-2">
          <div className="card">
            <div className="eyebrow">Step 01</div>
            <h3>Connect QoreX &amp; MetaMask</h3>
            <p className="muted">QoreX opens your EVM authorization window; MetaMask sends EVM transactions.</p>
          </div>
          <div className="card">
            <div className="eyebrow">Step 02</div>
            <h3>Create &amp; Back Up Your Lattice Key</h3>
            <p className="muted">Generate an encrypted ML-DSA-87 key in your browser and save your backup file.</p>
          </div>
          <div className="card">
            <div className="eyebrow">Step 03</div>
            <h3>Deploy Your Isolated Vault</h3>
            <p className="muted">Deploy your own vault from VaultFactory with daily limits and the 0x0A02 firewall.</p>
          </div>
          <div className="card">
            <div className="eyebrow">Step 04</div>
            <h3>Fund, Monitor &amp; Freeze Anytime</h3>
            <p className="muted">Deposit QOR or ERC-20 fUSD, test attacks read-only, or freeze instantly if needed.</p>
          </div>
        </div>
      </section>

      <section className="faq-section" aria-labelledby="faq-heading">
        <div className="eyebrow">Questions</div>
        <h2 id="faq-heading" style={{ fontSize: "clamp(1.5rem, 3.5vw, 2.25rem)", margin: "6px 0 16px" }}>
          Frequently asked questions
        </h2>
        {FAQS.map((item, idx) => (
          <div key={item.q} className="faq-item">
            <button
              type="button"
              className="faq-trigger"
              aria-expanded={openFaq === idx}
              onClick={() => setOpenFaq(openFaq === idx ? null : idx)}
            >
              <span>{item.q}</span>
              <span aria-hidden="true">{openFaq === idx ? "−" : "+"}</span>
            </button>
            {openFaq === idx && (
              <p className="muted" style={{ marginTop: 0, paddingBottom: 16 }}>
                {item.a}
              </p>
            )}
          </div>
        ))}
      </section>

      <section className="card" style={{ marginTop: 32 }} aria-labelledby="honest-heading">
        <div className="eyebrow">Honest Scope</div>
        <h2 id="honest-heading" style={{ marginTop: 6 }}>
          Testnet prototype — what&apos;s not done yet
        </h2>
        <ul className="muted" style={{ paddingLeft: 20, marginBottom: 0 }}>
          <li>Runs on QoreChain Diana testnet (Chain ID 9800) only; smart contracts are unaudited.</li>
          <li>QoreX arbitrary ML-DSA message signing (<code>signArbitrary</code>) has not shipped yet, so sovereign signing uses the encrypted browser Lattice key.</li>
          <li>Stateless relayer code exists in <code>packages/relayer</code>; until hosted, sovereign actions fall back to MetaMask submission.</li>
        </ul>
      </section>

      <footer className="site-footer">
        <span>LatticeWard · Testnet Prototype · MIT License</span>
        <div className="row-wrap">
          <a href="https://github.com/Emmanuel-webDev/LatticeWard-protocol" target="_blank" rel="noreferrer">
            GitHub Source
          </a>
          <button type="button" className="btn" onClick={onOpenApp}>
            Launch App
          </button>
        </div>
      </footer>
    </div>
  );
}
