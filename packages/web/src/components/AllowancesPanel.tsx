import { useEffect, useState } from "react";
import { AbiCoder, Interface, formatEther, formatUnits, parseEther, parseUnits } from "ethers";
import { FUSD_ADDRESS, VAULT_ABI, ZERO_ADDRESS, explorerTxUrl } from "../lib/constants";
import { type VaultSnapshot, signSovereignCall, submitViaRelayerOrMetaMask } from "../lib/chain";
import type { BrowserKeySigner } from "../lib/signer";
import { mapChainError, type MetaMaskConnection } from "../lib/wallets";

interface Props {
  vault: VaultSnapshot | null;
  metamask: MetaMaskConnection | null;
  unlockedSigner: BrowserKeySigner | null;
  relayerUrl: string;
  onRefresh: () => void;
}

export function AllowancesPanel({ vault, metamask, unlockedSigner, relayerUrl, onRefresh }: Props) {
  const [preset, setPreset] = useState<"cautious" | "standard" | "custom">("custom");
  const [qorEnabled, setQorEnabled] = useState(true);
  const [qorMaxTx, setQorMaxTx] = useState("0.1");
  const [qorDaily, setQorDaily] = useState("0.3");
  const [fusdEnabled, setFusdEnabled] = useState(true);
  const [fusdMaxTx, setFusdMaxTx] = useState("1");
  const [fusdDaily, setFusdDaily] = useState("3");
  const [requirePqc, setRequirePqc] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  useEffect(() => {
    if (!vault) return;
    setQorEnabled(vault.qorLimit.enabled);
    setQorMaxTx(formatEther(vault.qorLimit.maxTxValue));
    setQorDaily(formatEther(vault.qorLimit.epochLimit));
    setFusdEnabled(vault.fusdLimit.enabled);
    setFusdMaxTx(formatUnits(vault.fusdLimit.maxTxValue, vault.fusdDecimals));
    setFusdDaily(formatUnits(vault.fusdLimit.epochLimit, vault.fusdDecimals));
    setRequirePqc(vault.requireRecipientPqc);
  }, [vault]);

  if (!vault) {
    return (
      <section className="card">
        <h2>Consumer Guardrail Configurator</h2>
        <p className="muted">Select or create a vault first to configure daily limits and the quantum-safety firewall.</p>
      </section>
    );
  }

  const applyPreset = (p: "cautious" | "standard") => {
    setPreset(p);
    if (p === "cautious") {
      setQorEnabled(true);
      setQorMaxTx("0.1");
      setQorDaily("0.3");
      setFusdEnabled(true);
      setFusdMaxTx("1");
      setFusdDaily("3");
      setRequirePqc(true);
    } else {
      setQorEnabled(true);
      setQorMaxTx("1");
      setQorDaily("3");
      setFusdEnabled(true);
      setFusdMaxTx("10");
      setFusdDaily("30");
      setRequirePqc(true);
    }
  };

  const handleSaveAsset = async (assetKind: "QOR" | "fUSD") => {
    setErr(null);
    setTxHash(null);
    if (!unlockedSigner) {
      setErr("Unlock your Lattice key first to sign allowance changes.");
      return;
    }
    setBusy(true);
    try {
      const u =
        assetKind === "QOR"
          ? {
              asset: ZERO_ADDRESS,
              enabled: qorEnabled,
              maxTxValue: parseEther(qorMaxTx || "0"),
              epochLimit: parseEther(qorDaily || "0"),
            }
          : {
              asset: FUSD_ADDRESS,
              enabled: fusdEnabled,
              maxTxValue: parseUnits(fusdMaxTx || "0", vault.fusdDecimals),
              epochLimit: parseUnits(fusdDaily || "0", vault.fusdDecimals),
            };
      const coder = AbiCoder.defaultAbiCoder();
      const encoded = coder.encode(["tuple(address asset,bool enabled,uint256 maxTxValue,uint256 epochLimit)"], [u]);
      const { pk, sig } = await signSovereignCall(vault.address, "TAG_ASSET", encoded, unlockedSigner);
      const iface = new Interface(VAULT_ABI);
      const calldata = iface.encodeFunctionData("setAssetLimit", [u, pk, sig]);
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
      setBusy(false);
    }
  };

  const handleSaveFirewall = async () => {
    setErr(null);
    setTxHash(null);
    if (!unlockedSigner) {
      setErr("Unlock your Lattice key first.");
      return;
    }
    setBusy(true);
    try {
      const policy = {
        agent: vault.agentKey,
        windowExpiresAt: BigInt(vault.windowExpiresAt),
        epochDuration: BigInt(vault.epochDuration),
        maxRiskScoreBps: BigInt(vault.maxRiskScoreBps),
        requireRecipientPqc: requirePqc,
        frozen: vault.frozen,
      };
      const coder = AbiCoder.defaultAbiCoder();
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
      setBusy(false);
    }
  };

  return (
    <section className="card" aria-labelledby="allowances-heading">
      <div className="eyebrow">Plane 2 · Sovereign Policy Controls (0x0A01)</div>
      <h2 id="allowances-heading" style={{ marginTop: 4 }}>
        Consumer Guardrail Configurator
      </h2>
      <p className="muted">
        Set per-payment and daily limits for your agent key.{" "}
        <span title="The day starts at the first payment.">
          <strong>Daily limit</strong>: the 24-hour window starts at the first payment.
        </span>
      </p>

      {err && (
        <div className="alert alert-danger" role="alert">
          {err}
        </div>
      )}
      {txHash && (
        <div className="alert alert-safe" role="status" aria-live="polite">
          Guardrail updated on-chain:{" "}
          <a href={explorerTxUrl(txHash)} target="_blank" rel="noreferrer">
            View Transaction
          </a>
        </div>
      )}

      <div className="row-wrap" style={{ marginBottom: 14 }}>
        <button
          type="button"
          className={`btn ${preset === "cautious" ? "btn-primary" : ""}`}
          onClick={() => applyPreset("cautious")}
        >
          Cautious (0.1 / 0.3 QOR)
        </button>
        <button
          type="button"
          className={`btn ${preset === "standard" ? "btn-primary" : ""}`}
          onClick={() => applyPreset("standard")}
        >
          Standard (1 / 3 QOR)
        </button>
        <button
          type="button"
          className={`btn ${preset === "custom" ? "btn-primary" : ""}`}
          onClick={() => setPreset("custom")}
        >
          Custom
        </button>
      </div>

      <div className="grid-2">
        <div className="diff-box">
          <h3>QOR Daily Allowance</h3>
          <label className="row-wrap" style={{ marginBottom: 10 }}>
            <input
              type="checkbox"
              checked={qorEnabled}
              onChange={(e) => {
                setPreset("custom");
                setQorEnabled(e.target.checked);
              }}
              style={{ width: 22, height: 22 }}
            />
            <span>Allow QOR payments</span>
          </label>
          <div className="field">
            <label htmlFor="al-qor-tx">Max per payment (QOR): {qorMaxTx}</label>
            <input
              type="range"
              min="0.01"
              max="10"
              step="0.01"
              value={Number(qorMaxTx) || 0.1}
              onChange={(e) => {
                setPreset("custom");
                setQorMaxTx(e.target.value);
              }}
              aria-label="QOR max per payment slider"
            />
            <input
              id="al-qor-tx"
              type="number"
              step="0.01"
              value={qorMaxTx}
              onChange={(e) => {
                setPreset("custom");
                setQorMaxTx(e.target.value);
              }}
            />
          </div>
          <div className="field">
            <label htmlFor="al-qor-day">Daily limit (QOR): {qorDaily}</label>
            <input
              type="range"
              min="0.05"
              max="30"
              step="0.05"
              value={Number(qorDaily) || 0.3}
              onChange={(e) => {
                setPreset("custom");
                setQorDaily(e.target.value);
              }}
              aria-label="QOR daily limit slider"
            />
            <input
              id="al-qor-day"
              type="number"
              step="0.01"
              value={qorDaily}
              onChange={(e) => {
                setPreset("custom");
                setQorDaily(e.target.value);
              }}
            />
          </div>
          <p className="muted tabular">
            <strong>Before:</strong>{" "}
            {vault.qorLimit.enabled
              ? `${formatEther(vault.qorLimit.maxTxValue)} / ${formatEther(vault.qorLimit.epochLimit)} QOR`
              : "Disabled"}
            <br />
            <strong>After:</strong> {qorEnabled ? `${qorMaxTx} / ${qorDaily} QOR` : "Disabled"}
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleSaveAsset("QOR")}
            disabled={busy || !unlockedSigner}
          >
            {busy ? "Signing..." : "Approve QOR Limit with Lattice Key"}
          </button>
        </div>

        <div className="diff-box">
          <h3>fUSD Daily Allowance</h3>
          <label className="row-wrap" style={{ marginBottom: 10 }}>
            <input
              type="checkbox"
              checked={fusdEnabled}
              onChange={(e) => {
                setPreset("custom");
                setFusdEnabled(e.target.checked);
              }}
              style={{ width: 22, height: 22 }}
            />
            <span>Allow fUSD payments</span>
          </label>
          <div className="field">
            <label htmlFor="al-fusd-tx">Max per payment (fUSD): {fusdMaxTx}</label>
            <input
              type="range"
              min="0.5"
              max="100"
              step="0.5"
              value={Number(fusdMaxTx) || 1}
              onChange={(e) => {
                setPreset("custom");
                setFusdMaxTx(e.target.value);
              }}
              aria-label="fUSD max per payment slider"
            />
            <input
              id="al-fusd-tx"
              type="number"
              step="0.1"
              value={fusdMaxTx}
              onChange={(e) => {
                setPreset("custom");
                setFusdMaxTx(e.target.value);
              }}
            />
          </div>
          <div className="field">
            <label htmlFor="al-fusd-day">Daily limit (fUSD): {fusdDaily}</label>
            <input
              type="range"
              min="1"
              max="300"
              step="1"
              value={Number(fusdDaily) || 3}
              onChange={(e) => {
                setPreset("custom");
                setFusdDaily(e.target.value);
              }}
              aria-label="fUSD daily limit slider"
            />
            <input
              id="al-fusd-day"
              type="number"
              step="0.1"
              value={fusdDaily}
              onChange={(e) => {
                setPreset("custom");
                setFusdDaily(e.target.value);
              }}
            />
          </div>
          <p className="muted tabular">
            <strong>Before:</strong>{" "}
            {vault.fusdLimit.enabled
              ? `${formatUnits(vault.fusdLimit.maxTxValue, vault.fusdDecimals)} / ${formatUnits(vault.fusdLimit.epochLimit, vault.fusdDecimals)} fUSD`
              : "Disabled"}
            <br />
            <strong>After:</strong> {fusdEnabled ? `${fusdMaxTx} / ${fusdDaily} fUSD` : "Disabled"}
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleSaveAsset("fUSD")}
            disabled={busy || !unlockedSigner}
          >
            {busy ? "Signing..." : "Approve fUSD Limit with Lattice Key"}
          </button>
        </div>
      </div>

      <div className="diff-box" style={{ marginTop: 12 }}>
        <h3>Quantum-Safety Recipient Firewall (0x0A02)</h3>
        <label className="row-wrap" style={{ marginBottom: 8 }}>
          <input
            type="checkbox"
            checked={requirePqc}
            onChange={(e) => setRequirePqc(e.target.checked)}
            style={{ width: 22, height: 22 }}
          />
          <span>Require recipients to have a registered ML-DSA-87 key (recommended)</span>
        </label>
        {!requirePqc && (
          <div className="alert alert-danger">
            <strong>Warning:</strong> Turning off the quantum-safety firewall allows your agent key to send vault funds to
            unverified classical-only addresses. Keep this ON unless you specifically need to pay an external address.
          </div>
        )}
        <p className="muted">
          <strong>Before:</strong> {vault.requireRecipientPqc ? "ON" : "OFF"} → <strong>After:</strong>{" "}
          {requirePqc ? "ON" : "OFF"}
        </p>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void handleSaveFirewall()}
          disabled={busy || !unlockedSigner}
        >
          {busy ? "Signing..." : "Approve Firewall Change with Lattice Key"}
        </button>
      </div>
    </section>
  );
}
