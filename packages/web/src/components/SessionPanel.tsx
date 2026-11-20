import { explorerTxUrl } from "../lib/constants";
import type { EvmWindowStatus, VaultSnapshot } from "../lib/chain";

interface Props {
  evmWindow: EvmWindowStatus | null;
  vault: VaultSnapshot | null;
  busy?: boolean;
  onStartSession: () => void;
  onStopSession: () => void;
}

const PREFLIGHT_MODE = ((import.meta.env.VITE_PREFLIGHT_MODE as string | undefined) || "required").trim().toLowerCase();

export function SessionPanel({ evmWindow, vault, busy, onStartSession, onStopSession }: Props) {
  const isOpen = evmWindow?.status === "open";
  const agentPayments = (vault?.events ?? []).filter((e) => e.kind === "agent_payment");

  const budgetDisplay = (() => {
    if (!evmWindow || evmWindow.remainingValueUqor === "?" || evmWindow.remainingValueUqor === "0") {
      return isOpen ? "0 QOR" : "—";
    }
    const uqor = Number(evmWindow.remainingValueUqor);
    if (!Number.isFinite(uqor)) return `${evmWindow.remainingValueUqor} uqor`;
    return `${(uqor / 1_000_000).toFixed(4)} QOR (${evmWindow.remainingValueUqor} uqor)`;
  })();

  return (
    <section className="card" aria-labelledby="session-heading">
      <div className="row-wrap" style={{ justifyContent: "space-between", marginBottom: 10 }}>
        <div>
          <div className="eyebrow">EVM Execution Session</div>
          <h2 id="session-heading" style={{ marginTop: 4 }}>
            Session Window &amp; Agent Payments
          </h2>
        </div>
        <div className="row-wrap">
          <span className={`badge ${isOpen ? "badge-safe" : "badge-caution"}`}>
            {isOpen ? "● Session Active" : "○ Session Closed"}
          </span>
          {PREFLIGHT_MODE === "advisory" ? (
            <span
              className="badge badge-caution"
              title="PREFLIGHT_MODE=advisory: preflight_unavailable events are explicitly logged to audits/verdict-ledger.jsonl"
            >
              ⚠ Preflight Advisory (preflight_unavailable logged)
            </span>
          ) : (
            <span className="badge badge-safe" title="PREFLIGHT_MODE=required (fail-closed default)">
              ✓ Preflight Required
            </span>
          )}
        </div>
      </div>

      <p className="muted" style={{ marginTop: 0 }}>
        Sessions last about <strong>6 hours</strong> (<code>17,280</code> blocks max on QoreChain). Start a scoped
        session when you want to send EVM transactions or let your agent operate; stop it anytime to close the window
        immediately.
      </p>

      <div className="grid-3" style={{ marginTop: 12, marginBottom: 14 }}>
        <div className="diff-box" style={{ margin: 0 }}>
          <div className="eyebrow">Remaining Blocks</div>
          <div className="tabular" style={{ fontSize: "1.25rem", fontWeight: 600, marginTop: 4 }}>
            {evmWindow ? evmWindow.remainingBlocks : "—"}
          </div>
        </div>
        <div className="diff-box" style={{ margin: 0 }}>
          <div className="eyebrow">Remaining Txs</div>
          <div className="tabular" style={{ fontSize: "1.25rem", fontWeight: 600, marginTop: 4 }}>
            {evmWindow ? evmWindow.remainingTxs : "—"}
          </div>
        </div>
        <div className="diff-box" style={{ margin: 0 }}>
          <div className="eyebrow">Remaining Budget</div>
          <div className="tabular" style={{ fontSize: "1rem", fontWeight: 600, marginTop: 6 }}>
            {budgetDisplay}
          </div>
        </div>
      </div>

      <div className="row-wrap">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={onStartSession}>
          {busy ? "Waiting for QoreX..." : "Start 6h Session"}
        </button>
        <button type="button" className="btn btn-destructive" disabled={busy || !isOpen} onClick={onStopSession}>
          Stop Session (Close Window)
        </button>
      </div>

      <div style={{ marginTop: 18 }}>
        <div className="eyebrow">Recent Agent Payments &amp; Invoice IDs</div>
        {agentPayments.length === 0 ? (
          <p className="muted" style={{ marginTop: 6, marginBottom: 0 }}>
            No agent payments recorded in the last 50,000 blocks for this vault. Run <code>npm run agent:buy</code> or{" "}
            <code>latticeward_pay_invoice</code> to settle a paid-API invoice on-chain.
          </p>
        ) : (
          <ul className="checklist" style={{ marginTop: 8 }}>
            {agentPayments.slice(0, 8).map((ev) => (
              <li key={ev.id} className="check-item hairline-row">
                <div>
                  <strong>{ev.detail}</strong>
                  <div className="muted mono" style={{ marginTop: 2 }}>
                    Block {ev.blockNumber}
                    {ev.intentId ? ` · invoice/intentId: ${ev.intentId.slice(0, 18)}...` : ""}
                  </div>
                </div>
                <a className="btn" href={explorerTxUrl(ev.txHash)} target="_blank" rel="noreferrer">
                  View Tx
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
