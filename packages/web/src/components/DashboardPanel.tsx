import { useState } from "react";
import { Contract, formatEther, formatUnits, parseEther, parseUnits } from "ethers";
import {
  ERC20_ABI,
  FUSD_ADDRESS,
  FUSD_BANK_DENOM,
  explorerAddrUrl,
  explorerTxUrl,
} from "../lib/constants";
import type { VaultSnapshot } from "../lib/chain";
import { mapChainError, type MetaMaskConnection } from "../lib/wallets";

interface Props {
  vault: VaultSnapshot | null;
  metamask: MetaMaskConnection | null;
  userFusdBalance: bigint;
  onRefresh: () => void;
  onGoEmergency: () => void;
}

export function DashboardPanel({
  vault,
  metamask,
  userFusdBalance,
  onRefresh,
  onGoEmergency,
}: Props) {
  const [depositQor, setDepositQor] = useState("0.25");
  const [depositFusd, setDepositFusd] = useState("5");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  if (!vault) {
    return (
      <section className="card">
        <h2>No Vault Selected</h2>
        <p className="muted">
          Create your first isolated vault from <strong>Create Vault</strong>, or pick an existing vault above.
        </p>
      </section>
    );
  }

  const handleDepositQor = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    if (!metamask?.provider) {
      setErr("Connect MetaMask first so we can send your QOR deposit.");
      return;
    }
    setBusy("deposit-qor");
    try {
      const signer = await metamask.provider.getSigner();
      const tx = await signer.sendTransaction({ to: vault.address, value: parseEther(depositQor) });
      await tx.wait();
      setMsg(`Deposited ${depositQor} QOR into your vault.`);
      onRefresh();
    } catch (e2) {
      setErr(mapChainError(e2));
    } finally {
      setBusy(null);
    }
  };

  const handleDepositFusd = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    if (!metamask?.provider) {
      setErr("Connect MetaMask first so we can send your fUSD deposit.");
      return;
    }
    setBusy("deposit-fusd");
    try {
      const signer = await metamask.provider.getSigner();
      const fusd = new Contract(FUSD_ADDRESS, ERC20_ABI, signer);
      const tx = await fusd.transfer(vault.address, parseUnits(depositFusd, vault.fusdDecimals));
      await tx.wait();
      setMsg(`Deposited ${depositFusd} fUSD into your vault.`);
      onRefresh();
    } catch (e2) {
      setErr(mapChainError(e2));
    } finally {
      setBusy(null);
    }
  };

  const qorTx = formatEther(vault.qorLimit.maxTxValue);
  const qorDay = formatEther(vault.qorLimit.epochLimit);
  const fusdTx = formatUnits(vault.fusdLimit.maxTxValue, vault.fusdDecimals);
  const fusdDay = formatUnits(vault.fusdLimit.epochLimit, vault.fusdDecimals);

  return (
    <div>
      {err && (
        <div className="alert alert-danger" role="alert">
          {err}
        </div>
      )}
      {msg && (
        <div className="alert alert-safe" role="status" aria-live="polite">
          {msg}
        </div>
      )}

      {/* Vault Overview */}
      <section className="card" aria-labelledby="dash-heading">
        <div className="row-wrap" style={{ justifyContent: "space-between", marginBottom: 12 }}>
          <div>
            <div className="eyebrow">Active Vault</div>
            <h2 id="dash-heading" style={{ marginTop: 4 }}>
              Treasury Overview
            </h2>
            <div className="mono muted">{vault.address}</div>
            <div className="mono muted">{vault.qorAddress}</div>
          </div>
          <div className="row-wrap">
            <span className={`badge ${vault.frozen ? "badge-danger" : "badge-safe"}`}>
              {vault.frozen ? "❄ Frozen (Paused)" : "● Active"}
            </span>
            <button type="button" className="btn" onClick={onRefresh}>
              Refresh
            </button>
            <button type="button" className="btn btn-destructive" onClick={onGoEmergency}>
              Emergency
            </button>
          </div>
        </div>

        <p className="muted">Funds in your vault are protected by your Lattice key (ML-DSA-87) and on-chain daily limits.</p>

        <div className="grid-2" style={{ marginTop: 16 }}>
          <div className="diff-box" style={{ margin: 0 }}>
            <div className="eyebrow">Native QOR</div>
            <div className="big-metric tabular" style={{ marginTop: 6 }}>
              {formatEther(vault.qorBalance)} QOR
            </div>
            <div className="eyebrow" style={{ marginTop: 16 }}>
              ERC-20 fUSD
            </div>
            <div className="big-metric tabular" style={{ marginTop: 6 }}>
              {formatUnits(vault.fusdBalance, vault.fusdDecimals)} fUSD
            </div>
          </div>

          <div className="diff-box" style={{ margin: 0 }}>
            <div className="row-wrap" style={{ justifyContent: "space-between" }}>
              <div className="eyebrow">Allowances</div>
              <button
                type="button"
                className="tooltip-btn"
                title="The day starts at the first payment."
                aria-label="Daily limit info: The day starts at the first payment"
                onClick={() => setMsg("Daily limit note: The day starts at the first payment.")}
              >
                ?
              </button>
            </div>
            <p className="tabular" style={{ margin: "10px 0 8px" }}>
              <strong>QOR:</strong>{" "}
              {vault.qorLimit.enabled ? `Up to ${qorTx} QOR per payment, ${qorDay} QOR per day` : "Disabled"}
            </p>
            <p className="tabular" style={{ margin: "0 0 8px" }}>
              <strong>fUSD:</strong>{" "}
              {vault.fusdLimit.enabled ? `Up to ${fusdTx} fUSD per payment, ${fusdDay} fUSD per day` : "Disabled"}
            </p>
            <p className="muted" style={{ margin: 0 }}>
              Quantum-safety firewall (0x0A02):{" "}
              <span className={`badge ${vault.requireRecipientPqc ? "badge-safe" : "badge-caution"}`}>
                {vault.requireRecipientPqc ? "✓ ON" : "⚠ OFF"}
              </span>
            </p>
          </div>
        </div>
      </section>

      {/* Deposit */}
      <section className="card" aria-labelledby="deposit-heading">
        <h2 id="deposit-heading">Deposit into Vault</h2>
        <div className="grid-2">
          <form onSubmit={handleDepositQor}>
            <div className="field">
              <label htmlFor="dep-qor">Native QOR amount</label>
              <input
                id="dep-qor"
                type="number"
                step="0.01"
                min="0.001"
                value={depositQor}
                onChange={(e) => setDepositQor(e.target.value)}
              />
            </div>
            <button type="submit" className="btn btn-primary" disabled={busy !== null || !metamask?.connected}>
              {busy === "deposit-qor" ? "Sending..." : "Deposit QOR"}
            </button>
          </form>

          {userFusdBalance > 0n ? (
            <form onSubmit={handleDepositFusd}>
              <div className="field">
                <label htmlFor="dep-fusd">
                  ERC-20 fUSD (you hold {formatUnits(userFusdBalance, vault.fusdDecimals)} fUSD)
                </label>
                <input
                  id="dep-fusd"
                  type="number"
                  step="0.1"
                  min="0.1"
                  value={depositFusd}
                  onChange={(e) => setDepositFusd(e.target.value)}
                />
              </div>
              <button type="submit" className="btn btn-primary" disabled={busy !== null || !metamask?.connected}>
                {busy === "deposit-fusd" ? "Sending..." : "Deposit fUSD"}
              </button>
            </form>
          ) : (
            <div className="alert alert-caution" style={{ margin: 0 }}>
              <strong>0 ERC-20 fUSD in MetaMask.</strong> Faucet fUSD starts as a Cosmos bank coin (
              <span className="mono">{FUSD_BANK_DENOM}</span>). Convert it to ERC-20 fUSD via QoreX or{" "}
              <code>npm run convert:fusd</code> before depositing.
            </div>
          )}
        </div>
      </section>

      {/* Activity Timeline */}
      <section className="card" aria-labelledby="timeline-heading">
        <div className="row-wrap" style={{ justifyContent: "space-between", marginBottom: 8 }}>
          <h2 id="timeline-heading" style={{ margin: 0 }}>
            Activity Timeline
          </h2>
          <a href={explorerAddrUrl(vault.address)} target="_blank" rel="noreferrer">
            Open Vault on Explorer
          </a>
        </div>
        {vault.events.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            No recent vault events in the last 50,000 blocks.
          </p>
        ) : (
          <ul className="checklist">
            {vault.events.map((ev) => (
              <li key={ev.id} className="check-item hairline-row">
                <div>
                  <strong>{ev.title}</strong>
                  <div className="muted tabular">
                    Block {ev.blockNumber} · {ev.detail}
                  </div>
                </div>
                <a className="btn" href={explorerTxUrl(ev.txHash)} target="_blank" rel="noreferrer">
                  View Tx
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
