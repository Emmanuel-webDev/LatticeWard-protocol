import { useState } from "react";
import { Wallet, isAddress } from "ethers";
import {
  type AttackSimResult,
  type EvmWindowStatus,
  type PqcStatus,
  type VaultSnapshot,
  checkPqcKeyStatus,
  fetchEvmWindowStatus,
  runAttackSimulations,
} from "../lib/chain";
import { EVM_RPC_URL, FUSD_ADDRESS } from "../lib/constants";

export function AgentAccountPanel({ vault, relayerUrl }: { vault: VaultSnapshot | null; relayerUrl: string }) {
  const [addr, setAddr] = useState(vault?.agentKey || "");
  const [pqc, setPqc] = useState<PqcStatus | null>(null);
  const [win, setWin] = useState<EvmWindowStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const checkAddr = async () => {
    setErr(null);
    if (!isAddress(addr)) {
      setErr("Enter a valid 0x agent address.");
      return;
    }
    setBusy(true);
    try {
      const [p, w] = await Promise.all([checkPqcKeyStatus(addr), fetchEvmWindowStatus(addr, relayerUrl)]);
      setPqc(p);
      setWin(w);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const mcpSnippet = JSON.stringify(
    {
      mcpServers: {
        latticeward: {
          command: "npx",
          args: ["tsx", "packages/agent-mcp/src/mcp-server.ts"],
          env: {
            QOR_EVM_RPC: EVM_RPC_URL,
            VAULT_ADDRESS: vault?.address || "0x...",
            FUSD_ADDRESS,
            AGENT_PRIVATE_KEY: "<your-disposable-agent-key>",
          },
        },
      },
    },
    null,
    2,
  );

  return (
    <section className="card" aria-labelledby="agent-heading">
      <h2 id="agent-heading">Agent Account &amp; MCP Configuration</h2>
      <p className="muted">
        An autonomous AI agent uses a separate disposable classical key (<code>agentKey</code>) that can only pay within
        your daily limits. Because QoreChain EVM windows last at most <strong>~6 hours</strong> (<code>17,280</code>{" "}
        blocks), an agent service must keep its own ML-DSA-87 registered account and reopen its own EVM window on a
        schedule.
      </p>

      {err && (
        <div className="alert alert-danger" role="alert">
          {err}
        </div>
      )}

      <div className="field">
        <label htmlFor="agent-check-addr">Agent 0x Address</label>
        <div className="row-wrap">
          <input
            id="agent-check-addr"
            type="text"
            value={addr}
            onChange={(e) => setAddr(e.target.value)}
            placeholder="0x..."
            style={{ flex: 1, minWidth: 220 }}
          />
          <button type="button" className="btn btn-primary" onClick={() => void checkAddr()} disabled={busy}>
            {busy ? "Checking..." : "Check 0x0A02 & Window"}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              const w = Wallet.createRandom();
              setAddr(w.address);
              setPqc(null);
              setWin(null);
            }}
          >
            Generate Fresh Address
          </button>
        </div>
      </div>

      {pqc && (
        <div className="diff-box">
          <p style={{ margin: "0 0 6px" }}>
            <strong>PQC Key Registered (0x0A02):</strong>{" "}
            <span className={`badge ${pqc.registered ? "badge-active" : "badge-frozen"}`}>
              {pqc.registered ? `✓ Registered (${pqc.pubKeyBytes} bytes)` : "✕ Not Registered"}
            </span>
          </p>
          {win && (
            <p style={{ margin: 0 }}>
              <strong>EVM Window:</strong> {win.message}
            </p>
          )}
        </div>
      )}

      <div style={{ marginTop: 14 }}>
        <div className="row-wrap" style={{ justifyContent: "space-between", marginBottom: 6 }}>
          <h3 style={{ margin: 0 }}>Copy-ready MCP Config (Claude Desktop / Cursor)</h3>
          <button
            type="button"
            className="btn"
            onClick={() => {
              void navigator.clipboard.writeText(mcpSnippet);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? "Copied!" : "Copy Config"}
          </button>
        </div>
        <pre className="diff-box mono" style={{ overflowX: "auto" }}>
          {mcpSnippet}
        </pre>
      </div>
    </section>
  );
}

export function AttackLabPanel({ vault }: { vault: VaultSnapshot | null }) {
  const [results, setResults] = useState<AttackSimResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!vault) {
    return (
      <section className="card">
        <h2>Attack Lab</h2>
        <p className="muted">Select or create a vault first to run live read-only attack simulations against it.</p>
      </section>
    );
  }

  const run = async () => {
    setErr(null);
    setBusy(true);
    try {
      setResults(await runAttackSimulations(vault));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card" aria-labelledby="attack-heading">
      <h2 id="attack-heading">Live Attack Lab (Read-Only)</h2>
      <p className="muted">
        Simulates real attacks against your selected vault (<span className="mono">{vault.address}</span>) using{" "}
        <code>eth_call</code> on QoreChain testnet. Costs zero gas and changes no state.
      </p>
      {err && (
        <div className="alert alert-danger" role="alert">
          {err}
        </div>
      )}
      <button type="button" className="btn btn-primary" onClick={() => void run()} disabled={busy}>
        {busy ? "Running Simulations..." : "Run 4 Live Attack Simulations"}
      </button>

      {results && (
        <ul className="checklist">
          {results.map((r) => (
            <li key={r.id} className="check-item">
              <div>
                <div className="row-wrap">
                  <span className={`badge ${r.blocked ? "badge-active" : "badge-frozen"}`}>
                    {r.blocked ? `✓ Blocked (${r.errorName})` : `✕ Allowed (${r.errorName})`}
                  </span>
                  <strong>{r.label}</strong>
                </div>
                <p className="muted" style={{ margin: "4px 0 0" }}>
                  {r.explanation}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function GlossaryPanel() {
  const terms = [
    {
      term: "Lattice Key (ML-DSA-87)",
      def: "A post-quantum digital signature key (NIST FIPS 204) stored encrypted in your browser. It is the only key that can freeze, unfreeze, withdraw, or change your vault's rules.",
    },
    {
      term: "Daily Limit",
      def: "The maximum amount your agent key can spend in a 24-hour period. The day starts at the first payment.",
    },
    {
      term: "EVM Window",
      def: "A temporary permission opened in QoreX that lets MetaMask send EVM transactions on QoreChain for up to ~6 hours (17,280 blocks).",
    },
    {
      term: "Quantum-Safety Firewall (0x0A02)",
      def: "An on-chain check that blocks your vault from paying any address that does not have a registered ML-DSA-87 key.",
    },
    {
      term: "Scoped Agent Key",
      def: "A hot classical key used by an AI agent for routine payments. Even if it leaks, it cannot exceed daily limits or change vault rules.",
    },
  ];
  return (
    <section className="card" aria-labelledby="glossary-heading">
      <h2 id="glossary-heading">Glossary &amp; Key-Custody Guide</h2>
      <ul className="checklist">
        {terms.map((t) => (
          <li key={t.term} className="check-item">
            <div>
              <strong>{t.term}</strong>
              <p className="muted" style={{ margin: "4px 0 0" }}>
                {t.def}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
