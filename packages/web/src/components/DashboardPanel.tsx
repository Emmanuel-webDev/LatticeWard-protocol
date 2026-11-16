import { useRef, useState } from "react";
import { AbiCoder, Contract, Interface, formatEther, formatUnits, isAddress, parseEther, parseUnits } from "ethers";
import {
  ERC20_ABI,
  FUSD_ADDRESS,
  FUSD_BANK_DENOM,
  VAULT_ABI,
  ZERO_ADDRESS,
  explorerAddrUrl,
  explorerTxUrl,
} from "../lib/constants";
import {
  type EvmWindowStatus,
  type VaultSnapshot,
  signSovereignCall,
  submitViaRelayerOrMetaMask,
} from "../lib/chain";
import type { BrowserKeySigner } from "../lib/signer";
import { mapChainError, type MetaMaskConnection } from "../lib/wallets";

interface Props {
  vault: VaultSnapshot | null;
  metamask: MetaMaskConnection | null;
  unlockedSigner: BrowserKeySigner | null;
  userFusdBalance: bigint;
  evmWindow: EvmWindowStatus | null;
  relayerUrl: string;
  onRefresh: () => void;
}

export function DashboardPanel({
  vault,
  metamask,
  unlockedSigner,
  userFusdBalance,
  evmWindow,
  relayerUrl,
  onRefresh,
}: Props) {
  const [depositQor, setDepositQor] = useState("0.25");
  const [depositFusd, setDepositFusd] = useState("5");
  const [withdrawTo, setWithdrawTo] = useState(metamask?.address || "");
  const [withdrawAmt, setWithdrawAmt] = useState("0.1");
  const [withdrawAsset, setWithdrawAsset] = useState<"QOR" | "fUSD">("QOR");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [holdPct, setHoldPct] = useState(0);
  const [confirmWithdrawOpen, setConfirmWithdrawOpen] = useState(false);
  const holdTimer = useRef<number | null>(null);

  if (!vault) {
    return (
      <section className="card">
        <h2>No Vault Selected Yet</h2>
        <p className="muted">
          Create your first isolated vault from the <strong>Create Vault</strong> tab, or select an existing vault address
          above.
        </p>
      </section>
    );
  }

  const handleDepositQor = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    if (!metamask?.provider) {
      setErr("Connect MetaMask to deposit QOR.");
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
      setErr("Connect MetaMask to deposit ERC-20 fUSD.");
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

  const toggleFreeze = async (freeze: boolean) => {
    setErr(null);
    setMsg(null);
    if (!unlockedSigner) {
      setErr("Unlock your Lattice key first to sign Freeze / Unfreeze.");
      return;
    }
    setBusy(freeze ? "freeze" : "unfreeze");
    try {
      const coder = AbiCoder.defaultAbiCoder();
      const policy = {
        agent: vault.agentKey,
        windowExpiresAt: BigInt(vault.windowExpiresAt),
        epochDuration: BigInt(vault.epochDuration),
        maxRiskScoreBps: BigInt(vault.maxRiskScoreBps),
        requireRecipientPqc: vault.requireRecipientPqc,
        frozen: freeze,
      };
      const encoded = coder.encode(
        ["tuple(address agent,uint256 windowExpiresAt,uint256 epochDuration,uint256 maxRiskScoreBps,bool requireRecipientPqc,bool frozen)"],
        [policy],
      );
      const { pk, sig } = await signSovereignCall(vault.address, "TAG_CONFIGURE", encoded, unlockedSigner);
      const iface = new Interface(VAULT_ABI);
      const calldata = iface.encodeFunctionData("configurePolicy", [policy, pk, sig]);
      const res = await submitViaRelayerOrMetaMask({
        relayerUrl,
        vaultAddress: vault.address,
        calldata,
        metaMaskProvider: metamask?.provider ?? null,
      });
      setMsg(`${freeze ? "Vault frozen" : "Vault unfrozen"} via ${res.via} (tx ${res.txHash.slice(0, 12)}...).`);
      onRefresh();
    } catch (e2) {
      setErr(mapChainError(e2));
    } finally {
      setBusy(null);
      setHoldPct(0);
    }
  };

  const startHoldFreeze = () => {
    if (vault.frozen || busy) return;
    const start = Date.now();
    holdTimer.current = window.setInterval(() => {
      const elapsed = Date.now() - start;
      const pct = Math.min(100, Math.round((elapsed / 1200) * 100));
      setHoldPct(pct);
      if (pct >= 100) {
        if (holdTimer.current) clearInterval(holdTimer.current);
        holdTimer.current = null;
        void toggleFreeze(true);
      }
    }, 50);
  };

  const cancelHoldFreeze = () => {
    if (holdTimer.current) {
      clearInterval(holdTimer.current);
      holdTimer.current = null;
    }
    setHoldPct(0);
  };

  const handleSovereignWithdraw = async () => {
    setErr(null);
    setMsg(null);
    if (!unlockedSigner) {
      setErr("Unlock your Lattice key first.");
      return;
    }
    if (!isAddress(withdrawTo)) {
      setErr("Enter a valid 0x destination address.");
      return;
    }
    setBusy("withdraw");
    try {
      const asset = withdrawAsset === "QOR" ? ZERO_ADDRESS : FUSD_ADDRESS;
      const amount = withdrawAsset === "QOR" ? parseEther(withdrawAmt) : parseUnits(withdrawAmt, vault.fusdDecimals);
      const w = { asset, to: withdrawTo, amount };
      const coder = AbiCoder.defaultAbiCoder();
      const encoded = coder.encode(["tuple(address asset,address to,uint256 amount)"], [w]);
      const { pk, sig } = await signSovereignCall(vault.address, "TAG_WITHDRAW", encoded, unlockedSigner);
      const iface = new Interface(VAULT_ABI);
      const calldata = iface.encodeFunctionData("sovereignWithdraw", [w, pk, sig]);
      const res = await submitViaRelayerOrMetaMask({
        relayerUrl,
        vaultAddress: vault.address,
        calldata,
        metaMaskProvider: metamask?.provider ?? null,
      });
      setMsg(`Withdrew ${withdrawAmt} ${withdrawAsset} via ${res.via} (tx ${res.txHash.slice(0, 12)}...).`);
      setConfirmWithdrawOpen(false);
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
        <div className="alert alert-success" role="status" aria-live="polite">
          {msg}
        </div>
      )}

      {/* P0 4. Dashboard Overview */}
      <section className="card" aria-labelledby="dash-heading">
        <div className="row-wrap" style={{ justifyContent: "space-between", marginBottom: 10 }}>
          <div>
            <h2 id="dash-heading" style={{ margin: 0 }}>
              Vault Overview
            </h2>
            <div className="mono muted">{vault.address}</div>
            <div className="mono muted">{vault.qorAddress}</div>
          </div>
          <div className="row-wrap">
            <span className={`badge ${vault.frozen ? "badge-frozen" : "badge-active"}`}>
              {vault.frozen ? "❄ Frozen (Paused)" : "● Active"}
            </span>
            <button type="button" className="btn" onClick={onRefresh}>
              Refresh
            </button>
          </div>
        </div>

        <p className="muted">Funds in your vault are protected by your Lattice key (ML-DSA-87) and on-chain daily limits.</p>

        <div className="grid-2">
          <div className="diff-box">
            <h3>Vault Balances</h3>
            <p style={{ margin: "4px 0" }}>
              <strong>{formatEther(vault.qorBalance)} QOR</strong>
            </p>
            <p style={{ margin: "4px 0" }}>
              <strong>{formatUnits(vault.fusdBalance, vault.fusdDecimals)} fUSD</strong> (ERC-20)
            </p>
          </div>
          <div className="diff-box">
            <div className="row-wrap" style={{ justifyContent: "space-between" }}>
              <h3 style={{ margin: 0 }}>Allowances</h3>
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
            <p style={{ margin: "6px 0" }}>
              <strong>QOR:</strong>{" "}
              {vault.qorLimit.enabled ? `Up to ${qorTx} QOR per payment, ${qorDay} QOR per day` : "Disabled"}
            </p>
            <p style={{ margin: "6px 0" }}>
              <strong>fUSD:</strong>{" "}
              {vault.fusdLimit.enabled ? `Up to ${fusdTx} fUSD per payment, ${fusdDay} fUSD per day` : "Disabled"}
            </p>
            <p className="muted" style={{ margin: "4px 0 0" }}>
              Quantum-safety firewall (0x0A02): <strong>{vault.requireRecipientPqc ? "ON" : "OFF"}</strong>
            </p>
          </div>
        </div>
      </section>

      {/* P0 5. Deposit & P0 6. Emergency */}
      <div className="grid-2">
        <section className="card" aria-labelledby="deposit-heading">
          <h2 id="deposit-heading">Deposit into Vault</h2>
          <form onSubmit={handleDepositQor} style={{ marginBottom: 16 }}>
            <div className="field">
              <label htmlFor="dep-qor">Native QOR amount</label>
              <div className="row-wrap">
                <input
                  id="dep-qor"
                  type="number"
                  step="0.01"
                  min="0.001"
                  value={depositQor}
                  onChange={(e) => setDepositQor(e.target.value)}
                  style={{ flex: 1 }}
                />
                <button type="submit" className="btn btn-primary" disabled={busy !== null || !metamask?.connected}>
                  {busy === "deposit-qor" ? "Sending..." : "Deposit QOR"}
                </button>
              </div>
            </div>
          </form>

          {userFusdBalance > 0n ? (
            <form onSubmit={handleDepositFusd}>
              <div className="field">
                <label htmlFor="dep-fusd">
                  ERC-20 fUSD amount (you hold {formatUnits(userFusdBalance, vault.fusdDecimals)} fUSD)
                </label>
                <div className="row-wrap">
                  <input
                    id="dep-fusd"
                    type="number"
                    step="0.1"
                    min="0.1"
                    value={depositFusd}
                    onChange={(e) => setDepositFusd(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <button type="submit" className="btn btn-primary" disabled={busy !== null || !metamask?.connected}>
                    {busy === "deposit-fusd" ? "Sending..." : "Deposit fUSD"}
                  </button>
                </div>
              </div>
            </form>
          ) : (
            <div className="alert alert-warn">
              <strong>You currently hold 0 ERC-20 fUSD.</strong> On QoreChain, faucet fUSD starts as a Cosmos bank coin (
              <span className="mono">{FUSD_BANK_DENOM}</span>). Convert it to ERC-20 fUSD first using QoreX or{" "}
              <code>npm run convert:fusd</code> before depositing into the vault.
            </div>
          )}
        </section>

        <section className="card" aria-labelledby="emergency-heading">
          <h2 id="emergency-heading">Emergency Controls</h2>
          {evmWindow && evmWindow.status !== "open" && !relayerUrl && (
            <div className="alert alert-warn">
              <strong>Sub-window check:</strong> Sending Freeze/Unfreeze directly via MetaMask requires an open EVM
              window for your MetaMask address. {evmWindow.message}
            </div>
          )}

          <div className="row-wrap" style={{ marginBottom: 14 }}>
            {!vault.frozen ? (
              <>
                <button
                  type="button"
                  className="btn btn-danger hold-progress"
                  onMouseDown={startHoldFreeze}
                  onMouseUp={cancelHoldFreeze}
                  onMouseLeave={cancelHoldFreeze}
                  onTouchStart={startHoldFreeze}
                  onTouchEnd={cancelHoldFreeze}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      void toggleFreeze(true);
                    }
                  }}
                  disabled={busy !== null || !unlockedSigner}
                >
                  {busy === "freeze"
                    ? "Freezing..."
                    : holdPct > 0
                      ? `Holding to Freeze (${holdPct}%)`
                      : "Hold to Freeze Vault"}
                </button>
                <span className="muted">(Hold button or press Enter with keyboard)</span>
              </>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void toggleFreeze(false)}
                disabled={busy !== null || !unlockedSigner}
              >
                {busy === "unfreeze" ? "Unfreezing..." : "Unfreeze Vault with Lattice Key"}
              </button>
            )}
          </div>

          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
            <h3>Sovereign Withdraw (Lattice Key)</h3>
            <div className="grid-2">
              <div className="field">
                <label htmlFor="wd-asset">Asset</label>
                <select id="wd-asset" value={withdrawAsset} onChange={(e) => setWithdrawAsset(e.target.value as "QOR" | "fUSD")}>
                  <option value="QOR">QOR</option>
                  <option value="fUSD">fUSD (ERC-20)</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="wd-amt">Amount</label>
                <input id="wd-amt" type="number" step="0.01" min="0" value={withdrawAmt} onChange={(e) => setWithdrawAmt(e.target.value)} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="wd-to">Destination (0x...)</label>
              <input id="wd-to" type="text" value={withdrawTo} onChange={(e) => setWithdrawTo(e.target.value)} placeholder="0x..." />
            </div>
            {!confirmWithdrawOpen ? (
              <button
                type="button"
                className="btn"
                onClick={() => setConfirmWithdrawOpen(true)}
                disabled={busy !== null || !unlockedSigner}
              >
                Review Sovereign Withdrawal
              </button>
            ) : (
              <div className="diff-box">
                <p style={{ margin: "0 0 8px" }}>
                  <strong>Confirm withdrawal:</strong> Send{" "}
                  <strong>
                    {withdrawAmt} {withdrawAsset}
                  </strong>{" "}
                  to <span className="mono">{withdrawTo}</span>?
                </p>
                <div className="row-wrap">
                  <button type="button" className="btn btn-primary" onClick={() => void handleSovereignWithdraw()} disabled={busy !== null}>
                    {busy === "withdraw" ? "Signing & Sending..." : "Approve with Lattice Key"}
                  </button>
                  <button type="button" className="btn" onClick={() => setConfirmWithdrawOpen(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Activity Timeline */}
      <section className="card" aria-labelledby="timeline-heading">
        <div className="row-wrap" style={{ justifyContent: "space-between" }}>
          <h2 id="timeline-heading" style={{ margin: 0 }}>
            Activity Timeline
          </h2>
          <a href={explorerAddrUrl(vault.address)} target="_blank" rel="noreferrer">
            Open Vault on Explorer
          </a>
        </div>
        {vault.events.length === 0 ? (
          <p className="muted" style={{ marginTop: 10 }}>
            No recent vault events in the last 50,000 blocks.
          </p>
        ) : (
          <ul className="checklist">
            {vault.events.map((ev) => (
              <li key={ev.id} className="check-item">
                <div>
                  <strong>{ev.title}</strong>
                  <div className="muted">
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
