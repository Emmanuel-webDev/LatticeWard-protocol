import { useRef, useState } from "react";
import { AbiCoder, Interface, Wallet, isAddress, parseEther, parseUnits } from "ethers";
import { FUSD_ADDRESS, VAULT_ABI, ZERO_ADDRESS, explorerTxUrl } from "../lib/constants";
import {
  type EvmWindowStatus,
  type VaultSnapshot,
  checkPqcKeyStatus,
  signSovereignCall,
  submitViaRelayerOrMetaMask,
} from "../lib/chain";
import type { BrowserKeySigner } from "../lib/signer";
import { mapChainError, type MetaMaskConnection } from "../lib/wallets";

interface Props {
  vault: VaultSnapshot | null;
  metamask: MetaMaskConnection | null;
  unlockedSigner: BrowserKeySigner | null;
  evmWindow: EvmWindowStatus | null;
  relayerUrl: string;
  onRefresh: () => void;
}

export function EmergencyPanel({
  vault,
  metamask,
  unlockedSigner,
  evmWindow,
  relayerUrl,
  onRefresh,
}: Props) {
  const [newAgent, setNewAgent] = useState(() => Wallet.createRandom().address);
  const [rescueAddress, setRescueAddress] = useState("0xD6891e4Ef67be07b5DE9703Dcc4cf36eF4D15aae");
  const [sweepAssets, setSweepAssets] = useState(true);
  const [withdrawTo, setWithdrawTo] = useState(metamask?.address || "");
  const [withdrawAmt, setWithdrawAmt] = useState("0.1");
  const [withdrawAsset, setWithdrawAsset] = useState<"QOR" | "fUSD">("QOR");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [holdPct, setHoldPct] = useState(0);
  const [confirmClawbackOpen, setConfirmClawbackOpen] = useState(false);
  const [confirmWithdrawOpen, setConfirmWithdrawOpen] = useState(false);
  const holdTimer = useRef<number | null>(null);

  if (!vault) {
    return (
      <section className="card">
        <h2>Emergency Controls</h2>
        <p className="muted">Select or create a vault first to manage freeze, clawback, or sovereign withdrawal.</p>
      </section>
    );
  }

  const toggleFreeze = async (freeze: boolean) => {
    setErr(null);
    setTxHash(null);
    if (!unlockedSigner) {
      setErr("Your Lattice key is locked. Unlock it above before signing an emergency action.");
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
      setTxHash(res.txHash);
      onRefresh();
    } catch (e2) {
      setErr(mapChainError(e2));
    } finally {
      setBusy(null);
      setHoldPct(0);
    }
  };

  const handleQDayClawback = async () => {
    setErr(null);
    setTxHash(null);
    if (!unlockedSigner) {
      setErr("Unlock your Lattice key first to sign the ML-DSA-87 Q-Day Emergency Clawback.");
      return;
    }
    if (!isAddress(newAgent)) {
      setErr("Enter a valid 0x replacement agent address.");
      return;
    }
    const rescueTarget = sweepAssets ? rescueAddress.trim() : ZERO_ADDRESS;
    if (sweepAssets) {
      if (!isAddress(rescueTarget) || rescueTarget === ZERO_ADDRESS) {
        setErr("Enter a valid 0x quantum-safe rescue address.");
        return;
      }
      const pqc = await checkPqcKeyStatus(rescueTarget);
      if (!pqc.registered) {
        setErr(
          `Blocked by 0x0A02 pre-check: rescue address ${rescueTarget} does not have a registered ML-DSA-87 key.`,
        );
        return;
      }
    }

    setBusy("clawback");
    try {
      const assets = sweepAssets ? [ZERO_ADDRESS, FUSD_ADDRESS] : [];
      const clawback = {
        newAgent,
        rescue: rescueTarget,
        assets,
      };
      const coder = AbiCoder.defaultAbiCoder();
      const encoded = coder.encode(["tuple(address newAgent,address rescue,address[] assets)"], [clawback]);
      const { pk, sig } = await signSovereignCall(vault.address, "TAG_CLAWBACK", encoded, unlockedSigner);
      const iface = new Interface(VAULT_ABI);
      const calldata = iface.encodeFunctionData("triggerQDayEmergencyClawback", [clawback, pk, sig]);
      const res = await submitViaRelayerOrMetaMask({
        relayerUrl,
        vaultAddress: vault.address,
        calldata,
        metaMaskProvider: metamask?.provider ?? null,
      });
      setTxHash(res.txHash);
      setConfirmClawbackOpen(false);
      onRefresh();
    } catch (e2) {
      setErr(mapChainError(e2));
    } finally {
      setBusy(null);
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
    setTxHash(null);
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
      setTxHash(res.txHash);
      setConfirmWithdrawOpen(false);
      onRefresh();
    } catch (e2) {
      setErr(mapChainError(e2));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      {err && (
        <div className="alert alert-danger" role="alert">
          {err}
        </div>
      )}
      {txHash && (
        <div className="alert alert-safe" role="status" aria-live="polite">
          Sovereign emergency transaction confirmed:{" "}
          <a href={explorerTxUrl(txHash)} target="_blank" rel="noreferrer">
            View on Explorer
          </a>
        </div>
      )}

      {/* 1. Sovereign Emergency Kill-Switch (triggerQDayEmergencyClawback) */}
      <section
        className="card"
        style={{ borderColor: "var(--danger-line)" }}
        aria-labelledby="clawback-heading"
      >
        <div className="row-wrap" style={{ justifyContent: "space-between", marginBottom: 12 }}>
          <div>
            <div className="eyebrow">Plane 2 · Sovereign Kill-Switch (0x0A01 ML-DSA-87)</div>
            <h2 id="clawback-heading" style={{ marginTop: 4 }}>
              Trigger Q-Day Emergency Clawback &amp; Freeze
            </h2>
          </div>
          <span className={`badge ${vault.frozen ? "badge-danger" : "badge-safe"}`}>
            {vault.frozen ? "❄ Frozen (Paused)" : "● Active"}
          </span>
        </div>

        <p className="muted">
          Calls <code>triggerQDayEmergencyClawback</code> with an ML-DSA-87 signature verified by precompile{" "}
          <code>0x0A01</code> to atomically freeze the vault, revoke the compromised <code>agentKey</code> (
          <span className="mono">{vault.agentKey.slice(0, 10)}...</span>), and optionally sweep all QOR and fUSD to a{" "}
          <code>0x0A02</code>-verified quantum-safe rescue address.
        </p>

        <div className="grid-2">
          <div className="field">
            <label htmlFor="cb-new-agent">Replacement Agent Address (0x...)</label>
            <div className="row-wrap">
              <input
                id="cb-new-agent"
                type="text"
                value={newAgent}
                onChange={(e) => setNewAgent(e.target.value)}
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="btn"
                onClick={() => setNewAgent(Wallet.createRandom().address)}
              >
                Rotate Fresh
              </button>
            </div>
          </div>

          <div className="field">
            <label htmlFor="cb-rescue">Quantum-Safe Rescue Address (0x0A02 verified)</label>
            <input
              id="cb-rescue"
              type="text"
              value={rescueAddress}
              onChange={(e) => setRescueAddress(e.target.value)}
              disabled={!sweepAssets}
              placeholder="0x..."
            />
          </div>
        </div>

        <label className="row-wrap" style={{ marginBottom: 12 }}>
          <input
            type="checkbox"
            checked={sweepAssets}
            onChange={(e) => setSweepAssets(e.target.checked)}
            style={{ width: 20, height: 20 }}
          />
          <span>Sweep native QOR and ERC-20 fUSD to the quantum-safe rescue address during clawback</span>
        </label>

        {!confirmClawbackOpen ? (
          <button
            type="button"
            className="btn btn-destructive"
            onClick={() => setConfirmClawbackOpen(true)}
            disabled={busy !== null || !unlockedSigner}
          >
            Trigger Q-Day Emergency Clawback &amp; Freeze
          </button>
        ) : (
          <div className="diff-box">
            <p style={{ margin: "0 0 10px" }}>
              <strong>Confirm atomic Q-Day Clawback:</strong>
              <br />• Freeze vault: <code>true</code>
              <br />• Revoke old agent <span className="mono">{vault.agentKey.slice(0, 10)}...</span> →{" "}
              <span className="mono">{newAgent.slice(0, 10)}...</span>
              <br />• Sweep QOR &amp; fUSD: {sweepAssets ? <span className="mono">{rescueAddress}</span> : "No (freeze + rotate only)"}
            </p>
            <div className="row-wrap">
              <button
                type="button"
                className="btn btn-destructive"
                onClick={() => void handleQDayClawback()}
                disabled={busy !== null}
              >
                {busy === "clawback" ? "Signing ML-DSA-87 & Broadcasting..." : "Sign & Execute Q-Day Clawback"}
              </button>
              <button type="button" className="btn" onClick={() => setConfirmClawbackOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      {/* 2. Quick Freeze / Unfreeze */}
      <section className="card" aria-labelledby="emergency-danger-heading">
        <div className="eyebrow">Pause / Resume</div>
        <h2 id="emergency-danger-heading" style={{ marginTop: 4 }}>
          {vault.frozen ? "Unfreeze Vault" : "Quick Freeze (Pause Without Sweep)"}
        </h2>

        <div className="diff-box">
          <div className="eyebrow">Submitter EVM Window Status</div>
          <p style={{ margin: "6px 0 0" }}>
            {evmWindow
              ? evmWindow.message
              : "Connect QoreX or MetaMask to check whether your submitting account has an open EVM window."}
          </p>
        </div>

        <div className="row-wrap" style={{ marginTop: 16 }}>
          {!vault.frozen ? (
            <>
              <button
                type="button"
                className="btn btn-destructive tabular"
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
                  ? "Freezing Vault..."
                  : holdPct > 0
                    ? `Hold to Freeze (${holdPct}%)`
                    : "Hold to Freeze Vault"}
              </button>
              <span className="muted">Hold for 1.2s (or press Enter with keyboard)</span>
            </>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void toggleFreeze(false)}
              disabled={busy !== null || !unlockedSigner}
            >
              {busy === "unfreeze" ? "Unfreezing Vault..." : "Unfreeze Vault with Lattice Key"}
            </button>
          )}
        </div>
      </section>

      {/* 3. Sovereign Withdraw */}
      <section className="card" aria-labelledby="withdraw-heading">
        <h2 id="withdraw-heading">Sovereign Withdrawal (ML-DSA-87)</h2>
        <p className="muted">Move a custom amount out of your vault directly using your Lattice key.</p>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="wd-asset">Asset</label>
            <select
              id="wd-asset"
              value={withdrawAsset}
              onChange={(e) => setWithdrawAsset(e.target.value as "QOR" | "fUSD")}
            >
              <option value="QOR">QOR</option>
              <option value="fUSD">fUSD (ERC-20)</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="wd-amt">Amount</label>
            <input
              id="wd-amt"
              type="number"
              step="0.01"
              min="0"
              value={withdrawAmt}
              onChange={(e) => setWithdrawAmt(e.target.value)}
            />
          </div>
        </div>
        <div className="field">
          <label htmlFor="wd-to">Destination (0x...)</label>
          <input
            id="wd-to"
            type="text"
            value={withdrawTo}
            onChange={(e) => setWithdrawTo(e.target.value)}
            placeholder="0x..."
          />
        </div>
        {!confirmWithdrawOpen ? (
          <button
            type="button"
            className="btn"
            onClick={() => setConfirmWithdrawOpen(true)}
            disabled={busy !== null || !unlockedSigner}
          >
            Review Withdrawal
          </button>
        ) : (
          <div className="diff-box">
            <p style={{ margin: "0 0 10px" }}>
              <strong>Confirm:</strong> Withdraw{" "}
              <strong className="tabular">
                {withdrawAmt} {withdrawAsset}
              </strong>{" "}
              to <span className="mono">{withdrawTo}</span>?
            </p>
            <div className="row-wrap">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handleSovereignWithdraw()}
                disabled={busy !== null}
              >
                {busy === "withdraw" ? "Signing & Sending..." : "Approve with Lattice Key"}
              </button>
              <button type="button" className="btn" onClick={() => setConfirmWithdrawOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
