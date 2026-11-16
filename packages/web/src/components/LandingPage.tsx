import { useEffect, useRef, useState } from "react";

interface Props {
  onOpenApp: () => void;
}

const USE_CASES = [
  {
    tag: "01 · Everyday Limits",
    title: "Let your AI pay small bills, never your whole balance",
    body: "Set a strict per-payment cap and a daily limit (the day starts at the first payment). Your AI assistant can handle routine tasks while your savings stay untouched.",
  },
  {
    tag: "02 · Trick-Proof",
    title: "Stops prompt injections at the vault door",
    body: "Even if an AI assistant is tricked into trying to send 10x your limit or pay an unverified address, the vault rejects the payment before a single coin leaves.",
  },
  {
    tag: "03 · Stolen-Key Safe",
    title: "A leaked spending key can't rewrite your rules",
    body: "Your agent's hot key has zero admin power. It cannot raise its own daily limit, turn off safety checks, or withdraw your vault.",
  },
  {
    tag: "04 · Instant Pause",
    title: "Freeze everything and recover on your terms",
    body: "If a device is lost or an agent misbehaves, freeze your vault with your quantum-safe Lattice key. Only you can unfreeze or move your funds.",
  },
];

const FAQS = [
  {
    q: "What happens if my AI assistant's spending key is stolen?",
    a: "The spending key can only pay within your per-payment and daily limits, and only to quantum-safe recipients when the recipient check is on. It cannot change your rules or drain your vault.",
  },
  {
    q: "Why do I connect both QoreX and MetaMask?",
    a: "QoreX manages your post-quantum identity and opens your EVM spending window. MetaMask signs standard transactions such as creating your personal vault or depositing funds.",
  },
  {
    q: "Where is my Master Lattice Key stored?",
    a: "It is generated in your browser, encrypted with your passphrase, and saved locally. Before creating your first vault, you download an encrypted backup file so you stay in full control.",
  },
  {
    q: "What does 'daily limit' mean?",
    a: "Your daily limit caps total spending over a 24-hour period. The day starts at the first payment.",
  },
];

export function LandingPage({ onOpenApp }: Props) {
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
        <div className="eyebrow">Post-Quantum Treasury Vault · QoreChain Testnet</div>
        <h1 id="hero-heading" className="hero-title hero-reveal">
          Agents spend. Quantum can&apos;t steal.
        </h1>
        <p className="hero-sub">
          Give your AI assistant a strict daily allowance while keeping your vault locked behind a quantum-safe
          recovery key. Funds in your vault are protected even if a hot key leaks.
        </p>
        <div className="row-wrap">
          <button type="button" className="btn btn-primary" onClick={onOpenApp}>
            Create your vault
          </button>
          <a className="btn" href="#how-it-works">
            How it works
          </a>
        </div>

        {/* Consumer Safeguards Strip */}
        <div className="live-strip" aria-label="Key vault safeguards">
          <div className="live-cell">
            <div className="eyebrow">Daily Allowance</div>
            <div style={{ fontWeight: 600, marginTop: 8 }}>Cap per payment &amp; per day</div>
          </div>
          <div className="live-cell">
            <div className="eyebrow">Recipient Check</div>
            <div style={{ fontWeight: 600, marginTop: 8 }}>Blocks unsafe addresses</div>
          </div>
          <div className="live-cell">
            <div className="eyebrow">Emergency Freeze</div>
            <div style={{ fontWeight: 600, marginTop: 8 }}>Pause spending anytime</div>
          </div>
          <div className="live-cell">
            <div className="eyebrow">Your Own Vault</div>
            <div style={{ fontWeight: 600, marginTop: 8 }}>Isolated, only you control it</div>
          </div>
        </div>
      </section>

      {/* 2. Two Planes Explainer */}
      <section className="planes-section" aria-labelledby="planes-heading">
        <div className="eyebrow">Why It Works</div>
        <h2 id="planes-heading" style={{ fontSize: "clamp(1.75rem, 4vw, 2.5rem)", margin: "8px 0 24px" }}>
          Two separate keys. Two levels of trust.
        </h2>

        <div className="planes-grid">
          <div>
            <div ref={plane1Ref} className={`plane-step ${activePlane === 1 ? "is-active" : ""}`}>
              <div className="eyebrow">Key 1 · Everyday Spending</div>
              <h3 style={{ marginTop: 8 }}>A limited allowance for your AI assistant</h3>
              <p className="muted">
                Your assistant uses a disposable spending key for routine payments. It can never spend more than your
                per-payment cap or daily limit, and can only pay quantum-safe recipients.
              </p>
              <button type="button" className="btn" onClick={() => setActivePlane(1)}>
                See Spending Key
              </button>
            </div>

            <div ref={plane2Ref} className={`plane-step ${activePlane === 2 ? "is-active" : ""}`}>
              <div className="eyebrow">Key 2 · Master Recovery</div>
              <h3 style={{ marginTop: 8 }}>Quantum-safe lock for rules &amp; recovery</h3>
              <p className="muted">
                Changing daily limits, freezing your vault, or withdrawing your balance requires your post-quantum
                Lattice key. Nobody else—not even the vault creator contract—can override it.
              </p>
              <button type="button" className="btn" onClick={() => setActivePlane(2)}>
                See Master Key
              </button>
            </div>
          </div>

          <div className="planes-sticky card" aria-live="polite">
            <div className="eyebrow">
              {activePlane === 1 ? "Spending Key (Limited)" : "Master Lattice Key (Full Control)"}
            </div>
            <svg
              viewBox="0 0 420 260"
              width="100%"
              role="img"
              aria-label={
                activePlane === 1
                  ? "Diagram showing everyday spending key limited by daily caps and recipient checks"
                  : "Diagram showing post-quantum Master Lattice Key controlling vault rules and freeze"
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
                Spending Key
              </text>
              <text x="30" y="66" fill="var(--text-muted)" fontSize="11">
                Routine AI payouts only
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
                Master Lattice Key
              </text>
              <text x="30" y="214" fill="var(--text-muted)" fontSize="11">
                Quantum-safe · Encrypted
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
                Your Personal Vault
              </text>
              <text x="258" y="116" fill="var(--text-muted)" fontSize="11">
                {activePlane === 1 ? "• Per-payment & daily cap" : "• Update daily limits"}
              </text>
              <text x="258" y="138" fill="var(--text-muted)" fontSize="11">
                {activePlane === 1 ? "• Quantum-safe recipients" : "• Instant freeze / unfreeze"}
              </text>
              <text x="258" y="160" fill="var(--text-muted)" fontSize="11">
                {activePlane === 1 ? "• Cannot change rules" : "• Withdraw anytime"}
              </text>
            </svg>
          </div>
        </div>
      </section>

      {/* 3. Real-Life Protection Scenarios */}
      <section className="proof-section" aria-labelledby="scenarios-heading">
        <div className="eyebrow">Built For Real Risks</div>
        <h2 id="scenarios-heading" style={{ fontSize: "clamp(1.5rem, 3.5vw, 2.25rem)", margin: "6px 0 24px" }}>
          What your vault protects you against
        </h2>
        <div className="grid-2">
          {USE_CASES.map((u) => (
            <div key={u.tag} className="card hairline-row" style={{ marginBottom: 0 }}>
              <div className="eyebrow">{u.tag}</div>
              <h3 style={{ marginTop: 8 }}>{u.title}</h3>
              <p className="muted" style={{ marginBottom: 0 }}>
                {u.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* 4. How It Works (4 Steps) */}
      <section id="how-it-works" className="steps-section" aria-labelledby="how-heading">
        <div className="eyebrow">Getting Started</div>
        <h2 id="how-heading" style={{ fontSize: "clamp(1.5rem, 3.5vw, 2.25rem)", margin: "6px 0 24px" }}>
          Up and running in 4 steps
        </h2>
        <div className="grid-2">
          <div className="card">
            <div className="eyebrow">Step 01</div>
            <h3>Connect QoreX &amp; MetaMask</h3>
            <p className="muted">QoreX opens your spending window; MetaMask lets you sign transactions in the browser.</p>
          </div>
          <div className="card">
            <div className="eyebrow">Step 02</div>
            <h3>Save Your Master Lattice Key</h3>
            <p className="muted">Create an encrypted post-quantum key and download your backup file to keep it safe.</p>
          </div>
          <div className="card">
            <div className="eyebrow">Step 03</div>
            <h3>Create Your Personal Vault</h3>
            <p className="muted">Deploy your own vault with your chosen daily allowance and recipient safety check.</p>
          </div>
          <div className="card">
            <div className="eyebrow">Step 04</div>
            <h3>Fund, Adjust Limits, or Freeze</h3>
            <p className="muted">Deposit QOR or fUSD, review activity anytime, and freeze immediately if you ever need to.</p>
          </div>
        </div>
      </section>

      {/* 5. FAQ */}
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

      <footer className="site-footer">
        <span>LatticeWard · Testnet Prototype · MIT License</span>
        <a href="https://github.com/Emmanuel-webDev/LatticeWard-protocol" target="_blank" rel="noreferrer">
          GitHub Source
        </a>
      </footer>
    </div>
  );
}
