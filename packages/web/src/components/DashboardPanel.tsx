import { useState } from "react";
import {
  Contract,
  Interface,
  Wallet,
  formatEther,
  formatUnits,
  isAddress,
  keccak256,
  parseEther,
  parseUnits,
  toUtf8Bytes,
} from "ethers";
import {
  ERC20_ABI,
  FUSD_ADDRESS,
  FUSD_BANK_DENOM,
  VAULT_ABI,
  ZERO_ADDRESS,
  explorerAddrUrl,
  explorerTxUrl,
} from "../lib/constants";
import { getReadProvider, type VaultSnapshot } from "../lib/chain";
import { evmToQor, mapChainError, type MetaMaskConnection } from "../lib/wallets";

interface Props {
  vault: VaultSnapshot | null;
  metamask: MetaMaskConnection | null;
  userFusdBalance: bigint;
  onRefresh: () => void;
  onGoEmergency: () => void;
}

interface FeedItem {
  id: string;
  time: string;
  mode: "SIMULATION" | "ON-CHAIN";
  status: "ALLOWED" | "BLOCKED";
  summary: string;
  detail: string;
  txHash?: string;
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
  const [intentAsset, setIntentAsset] = useState<"QOR" | "fUSD">("QOR");
  const [intentAmount, setIntentAmount] = useState("0.002");
  const [intentRecipient, setIntentRecipient] = useState("0xD6891e4Ef67be07b5DE9703Dcc4cf36eF4D15aae");
  const [intentRationale, setIntentRationale] = useState("Scoped AI agent settlement");
  const [feed, setFeed] = useState<FeedItem[]>([]);
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

  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  const epochDur = BigInt(vault.epochDuration || 86400);

  const qorEpochExpired = nowSec >= vault.qorLimit.epochStart + epochDur;
  const qorSpentActive = qorEpochExpired ? 0n : vault.qorLimit.epochSpent;
  const qorRemaining =
    vault.qorLimit.epochLimit > qorSpentActive ? vault.qorLimit.epochLimit - qorSpentActive : 0n;

  const fusdEpochExpired = nowSec >= vault.fusdLimit.epochStart + epochDur;
  const fusdSpentActive = fusdEpochExpired ? 0n : vault.fusdLimit.epochSpent;
  const fusdRemaining =
    vault.fusdLimit.epochLimit > fusdSpentActive ? vault.fusdLimit.epochLimit - fusdSpentActive : 0n;

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
      setMsg(`Deposited ${depositQor} QOR into vault.`);
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
      setMsg(`Deposited ${depositFusd} fUSD into vault.`);
      onRefresh();
    } catch (e2) {
      setErr(mapChainError(e2));
    } finally {
      setBusy(null);
    }
  };

  const buildIntentTuple = () => {
    if (!isAddress(intentRecipient)) {
      throw new Error("Enter a valid 0x recipient address.");
    }
    const target = intentAsset === "QOR" ? ZERO_ADDRESS : FUSD_ADDRESS;
    const value =
      intentAsset === "QOR"
        ? parseEther(intentAmount || "0")
        : parseUnits(intentAmount || "0", vault.fusdDecimals);
    const ts = Math.floor(Date.now() / 1000);
    return {
      intentId: keccak256(toUtf8Bytes(`ui-intent-${ts}-${Math.random()}`)),
      target,
      recipient: intentRecipient,
      value,
      deadline: BigInt(ts + 900),
      riskScoreBps: 100n,
      rationaleHash: keccak256(toUtf8Bytes(intentRationale || "Scoped payout")),
    };
  };

  const handleSimulateIntent = async () => {
    setErr(null);
    setMsg(null);
    setBusy("sim-intent");
    try {
      const env = buildIntentTuple();
      const iface = new Interface(VAULT_ABI);
      const data = iface.encodeFunctionData("executeScopedAgentIntent", [env]);
      await getReadProvider().call({
        from: vault.agentKey,
        to: vault.address,
        data,
      });
      setFeed((prev) => [
        {
          id: `${Date.now()}`,
          time: new Date().toLocaleTimeString(),
          mode: "SIMULATION",
          status: "ALLOWED",
          summary: `${intentAmount} ${intentAsset} -> ${intentRecipient.slice(0, 10)}...`,
          detail: "Passed per-tx cap, daily allowance, and 0x0A02 recipient firewall.",
        },
        ...prev,
      ]);
    } catch (e2: unknown) {
      const iface = new Interface(VAULT_ABI);
      const rawObj = e2 as { data?: string; info?: { error?: { data?: string } } };
      const errHex = rawObj?.data ?? rawObj?.info?.error?.data;
      let errName = "Reverted";
      if (typeof errHex === "string" && errHex.startsWith("0x")) {
        try {
          const decoded = iface.parseError(errHex);
          if (decoded) errName = decoded.name;
        } catch {
          errName = `Revert (${errHex.slice(0, 10)})`;
        }
      } else if (e2 instanceof Error) {
        errName = e2.message;
      }
      setFeed((prev) => [
        {
          id: `${Date.now()}`,
          time: new Date().toLocaleTimeString(),
          mode: "SIMULATION",
          status: "BLOCKED",
          summary: `${intentAmount} ${intentAsset} -> ${intentRecipient.slice(0, 10)}...`,
          detail: `Reverted on-chain with ${errName}`,
        },
        ...prev,
      ]);
    } finally {
      setBusy(null);
    }
  };

  const handleExecuteIntentOnChain = async () => {
    setErr(null);
    setMsg(null);
    if (!metamask?.provider) {
      setErr("Connect MetaMask (using the vault's active agentKey) to broadcast an on-chain agent payout.");
      return;
    }
    setBusy("exec-intent");
    try {
      const env = buildIntentTuple();
      const signer = await metamask.provider.getSigner();
      const contract = new Contract(vault.address, VAULT_ABI, signer);
      const tx = await contract.executeScopedAgentIntent(env);
      await tx.wait();
      setFeed((prev) => [
        {
          id: tx.hash,
          time: new Date().toLocaleTimeString(),
          mode: "ON-CHAIN",
          status: "ALLOWED",
          summary: `${intentAmount} ${intentAsset} -> ${intentRecipient.slice(0, 10)}...`,
          detail: "Committed on QoreChain Diana Testnet",
          txHash: tx.hash,
        },
        ...prev,
      ]);
      onRefresh();
    } catch (e2) {
      const mapped = mapChainError(e2);
      setFeed((prev) => [
        {
          id: `${Date.now()}`,
          time: new Date().toLocaleTimeString(),
          mode: "ON-CHAIN",
          status: "BLOCKED",
          summary: `${intentAmount} ${intentAsset} -> ${intentRecipient.slice(0, 10)}...`,
          detail: mapped,
        },
        ...prev,
      ]);
      setErr(mapped);
    } finally {
      setBusy(null);
    }
  };

  const qorTx = formatEther(vault.qorLimit.maxTxValue);
  const qorDay = formatEther(vault.qorLimit.epochLimit);
  const qorRem = formatEther(qorRemaining);
  const fusdTx = formatUnits(vault.fusdLimit.maxTxValue, vault.fusdDecimals);
  const fusdDay = formatUnits(vault.fusdLimit.epochLimit, vault.fusdDecimals);
  const fusdRem = formatUnits(fusdRemaining, vault.fusdDecimals);

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

      {/* 1. Live Vault Telemetry Dashboard */}
      <section className="card" aria-labelledby="dash-heading">
        <div className="row-wrap" style={{ justifyContent: "space-between", marginBottom: 12 }}>
          <div>
            <div className="eyebrow">Live Vault Telemetry</div>
            <h2 id="dash-heading" style={{ marginTop: 4 }}>
              Treasury &amp; Guardrail State
            </h2>
            <div className="mono muted">EVM: {vault.address}</div>
            <div className="mono muted">Native: {vault.qorAddress}</div>
          </div>
          <div className="row-wrap">
            <span className={`badge ${vault.frozen ? "badge-danger" : "badge-safe"}`}>
              {vault.frozen ? "❄ Frozen (Paused)" : "● Active"}
            </span>
            <span className={`badge ${vault.requireRecipientPqc ? "badge-safe" : "badge-caution"}`}>
              {vault.requireRecipientPqc ? "✓ 0x0A02 Firewall ON" : "⚠ 0x0A02 Firewall OFF"}
            </span>
            <button type="button" className="btn" onClick={onRefresh}>
              Refresh
            </button>
            <button type="button" className="btn btn-destructive" onClick={onGoEmergency}>
              Kill-Switch
            </button>
          </div>
        </div>

        <p className="muted">
          Funds in your vault are protected by your Lattice key (ML-DSA-87 via <code>0x0A01</code>) and on-chain daily
          limits.
        </p>

        <div className="grid-3" style={{ marginTop: 16 }}>
          <div className="diff-box" style={{ margin: 0 }}>
            <div className="eyebrow">Native QOR Balance</div>
            <div className="big-metric tabular" style={{ marginTop: 6 }}>
              {formatEther(vault.qorBalance)} QOR
            </div>
            <div className="muted tabular" style={{ marginTop: 8 }}>
              Remaining today: <strong>{qorRem}</strong> / {qorDay} QOR
            </div>
            <div className="muted tabular">Max per payment: {qorTx} QOR</div>
          </div>

          <div className="diff-box" style={{ margin: 0 }}>
            <div className="eyebrow">ERC-20 fUSD Balance</div>
            <div className="big-metric tabular" style={{ marginTop: 6 }}>
              {formatUnits(vault.fusdBalance, vault.fusdDecimals)} fUSD
            </div>
            <div className="muted tabular" style={{ marginTop: 8 }}>
              Remaining today: <strong>{fusdRem}</strong> / {fusdDay} fUSD
            </div>
            <div className="muted tabular">Max per payment: {fusdTx} fUSD</div>
          </div>

          <div className="diff-box" style={{ margin: 0 }}>
            <div className="row-wrap" style={{ justifyContent: "space-between" }}>
              <div className="eyebrow">Replay &amp; Plane Telemetry</div>
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
            <div className="tabular" style={{ marginTop: 8 }}>
              <strong>Policy Nonce:</strong> <code>{vault.policyNonce.toString()}</code>
            </div>
            <div className="tabular" style={{ marginTop: 4 }}>
              <strong>Window Expiry:</strong>{" "}
              <span className="muted">{new Date(vault.windowExpiresAt * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC</span>
            </div>
            <div className="tabular" style={{ marginTop: 4 }}>
              <strong>Epoch Duration:</strong> <span className="muted">{Math.round(vault.epochDuration / 3600)}h rolling</span>
            </div>
            <div style={{ marginTop: 6 }}>
              <strong>Active Agent Key:</strong>
              <div className="mono muted">{vault.agentKey}</div>
              <div className="mono muted">{evmToQor(vault.agentKey)}</div>
            </div>
            <div style={{ marginTop: 6 }}>
              <strong>Sovereign Key Hash:</strong>
              <div className="mono muted">{vault.sovereignKeyHash.slice(0, 18)}...</div>
            </div>
          </div>
        </div>
      </section>

      {/* 1.5 Layer 1 Protocol-Level x/abstractaccount Spending Rules & Hash-Chained Verdict Ledger */}
      <section className="card" aria-labelledby="aa-layer-heading">
        <div className="row-wrap" style={{ justifyContent: "space-between", marginBottom: 12 }}>
          <div>
            <div className="eyebrow">Layer 1 · Protocol-Level Smart-Account Spending Rules</div>
            <h2 id="aa-layer-heading" style={{ marginTop: 4 }}>
              Native <code>x/abstractaccount</code> &amp; Authenticated Verdict Ledger
            </h2>
          </div>
          <div className="row-wrap">
            <span className="badge badge-safe">● x/abstractaccount Active</span>
            <span className="badge badge-safe">✓ Hybrid ML-DSA-87 + secp256k1 Authority</span>
          </div>
        </div>

        <p className="muted">
          Before any agent proposal reaches the EVM or <code>LatticeWardVault</code>, QoreChain&apos;s native{" "}
          <code>x/abstractaccount</code> module enforces protocol-level <code>denom_limits</code> for both native{" "}
          <code>uqor</code> and bank-coin <code>fUSD</code> (<code>erc20:0x9714...63CA</code>), while{" "}
          <code>LatticeWardVault.assetLimits</code> enforces ERC-20 <code>fUSD</code> and native <code>QOR</code> caps
          inside the EVM vault alongside a deny-by-default <code>allowed_evm_calls</code> target allowlist, 30-day
          authenticator duration expiry, and EIP-191 <code>evmAuthSignBytesV2</code> authenticated messaging.
        </p>

        <div className="grid-3" style={{ marginTop: 12 }}>
          <div className="diff-box" style={{ margin: 0 }}>
            <div className="eyebrow">On-Chain Denom &amp; Value Limits</div>
            <div className="tabular" style={{ marginTop: 8 }}>
              <strong>Rule ID:</strong> <code>latticeward-vault-only</code>
            </div>
            <div className="tabular" style={{ marginTop: 4 }}>
              <strong>uqor Limits:</strong> <code>100,000 uqor/tx</code> (0.1 QOR) · <code>300,000 uqor/day</code> (0.3 QOR)
            </div>
            <div className="tabular" style={{ marginTop: 4 }}>
              <strong>Bank fUSD Limits:</strong> <code>1,000,000/tx</code> (1.0 fUSD) · <code>3,000,000/day</code> (3.0 fUSD)
            </div>
            <div className="tabular" style={{ marginTop: 4 }}>
              <strong>Vault ERC-20 fUSD:</strong> <code>1.0 fUSD/tx</code> · <code>3.0 fUSD/day</code> (via <code>assetLimits</code>)
            </div>
          </div>

          <div className="diff-box" style={{ margin: 0 }}>
            <div className="eyebrow">Target Allowlist &amp; Linked Authenticator</div>
            <div style={{ marginTop: 8 }}>
              <strong>Allowed EVM Calls (Deny-by-Default):</strong>
              <div className="mono muted">{vault.address}</div>
            </div>
            <div style={{ marginTop: 6 }}>
              <strong>Linked Authenticator (secp256k1 / EIP-191):</strong>
              <div className="mono muted">{vault.agentKey}</div>
            </div>
            <div className="tabular" style={{ marginTop: 4 }}>
              <strong>Permissions:</strong> <code>[&quot;evm&quot;, &quot;send&quot;]</code> (30-day TTL through Dec 15)
            </div>
          </div>

          <div className="diff-box" style={{ margin: 0 }}>
            <div className="eyebrow">Live Testnet Proof Hashes (Chain ID 9800)</div>
            <div className="tabular" style={{ marginTop: 8 }}>
              <strong>AA Rules &amp; 30d Link:</strong>{" "}
              <a
                className="mono"
                href={explorerTxUrl("A374DDC5C787BFAD914F9870F9318DB321C8580EBCC8CA0715505B239D9A9388")}
                target="_blank"
                rel="noreferrer"
              >
                A374DDC5...9388
              </a>
            </div>
            <div className="tabular" style={{ marginTop: 4 }}>
              <strong>Drill Window Closed:</strong>{" "}
              <a
                className="mono"
                href={explorerTxUrl("023BB99C0C6839A32C0A34E04B5A7E70B426E522358189878F92800E6DDE57D4")}
                target="_blank"
                rel="noreferrer"
              >
                023BB99C...57D4
              </a>
            </div>
            <div className="tabular" style={{ marginTop: 4 }}>
              <strong>In-Policy MsgExecuteEVM:</strong>{" "}
              <a
                className="mono"
                href={explorerTxUrl("D3AB9E1E52052BF0AB2D5A559A2EC9AB40D3563F05B5A8B867404D79D6D17E7A")}
                target="_blank"
                rel="noreferrer"
              >
                D3AB9E1E...7E7A
              </a>
            </div>
            <div className="tabular" style={{ marginTop: 4 }}>
              <strong>Revoke / Restore Proof:</strong>{" "}
              <a
                className="mono"
                href={explorerTxUrl("28084ACC143F4E20BAF992CD68D3AB2E31A066944073F7BE1581F740BB361D11")}
                target="_blank"
                rel="noreferrer"
              >
                28084ACC...1D11
              </a>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <div className="eyebrow">Hash-Chained Policy Verdict Ledger (audits/verdict-ledger.jsonl)</div>
          <ul className="checklist" style={{ marginTop: 8 }}>
            <li className="check-item hairline-row">
              <div>
                <span className="badge badge-safe">ALLOW #4</span>{" "}
                <strong className="tabular">1,000 uqor (0.001 QOR) → {vault.address.slice(0, 10)}...</strong>
                <div className="muted mono" style={{ marginTop: 4 }}>
                  entryHash: 0x19b2be9a...02954 · All 6 checks passed (tx, value, duration, target, 0x0A02, EIP-191 sig)
                </div>
              </div>
              <a
                className="btn"
                href={explorerTxUrl("D3AB9E1E52052BF0AB2D5A559A2EC9AB40D3563F05B5A8B867404D79D6D17E7A")}
                target="_blank"
                rel="noreferrer"
              >
                View Tx
              </a>
            </li>
            <li className="check-item hairline-row">
              <div>
                <span className="badge badge-danger">DENY #5</span>{" "}
                <strong className="tabular">1,000,000 uqor (1.0 QOR) → Value Cap Refusal</strong>
                <div className="muted mono" style={{ marginTop: 4 }}>
                  entryHash: 0x8babab61...c6d1 · Blocked by x/abstractaccount perTxLimit (100,000 uqor) &amp; ExceedsScopedMaxTxValue
                </div>
              </div>
            </li>
            <li className="check-item hairline-row">
              <div>
                <span className="badge badge-danger">DENY #6</span>{" "}
                <strong className="tabular">1,000 uqor → Expired Duration Window Refusal</strong>
                <div className="muted mono" style={{ marginTop: 4 }}>
                  entryHash: 0x95b9f539...d5a3 · Blocked by deadline / window expiry check &amp; IntentExpired
                </div>
              </div>
            </li>
            <li className="check-item hairline-row">
              <div>
                <span className="badge badge-danger">DENY #7</span>{" "}
                <strong className="tabular">0x0000...dEaD → Target Allowlist &amp; 0x0A02 Firewall Refusal</strong>
                <div className="muted mono" style={{ marginTop: 4 }}>
                  entryHash: 0x5d8055bf...83fa · Denied by x/abstractaccount allowed_evm_calls &amp; RecipientNotQuantumSafe
                </div>
              </div>
            </li>
          </ul>
        </div>
      </section>

      {/* 2. Live Agent Intent Executor & Feed */}
      <section className="card" aria-labelledby="executor-heading">
        <div className="row-wrap" style={{ justifyContent: "space-between", marginBottom: 8 }}>
          <div>
            <div className="eyebrow">Plane 1 · Scoped Execution</div>
            <h2 id="executor-heading" style={{ marginTop: 4 }}>
              Simulate / Execute Scoped Agent Payout
            </h2>
          </div>
          <div className="row-wrap">
            <button
              type="button"
              className="btn"
              onClick={() => {
                setIntentAsset("QOR");
                setIntentAmount("0.002");
                setIntentRecipient("0xD6891e4Ef67be07b5DE9703Dcc4cf36eF4D15aae");
              }}
            >
              Preset: Valid Payout
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setIntentAsset("QOR");
                setIntentAmount("1.0");
                setIntentRecipient("0xD6891e4Ef67be07b5DE9703Dcc4cf36eF4D15aae");
              }}
            >
              Preset: Over-Spend (10x)
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setIntentAsset("QOR");
                setIntentAmount("0.002");
                setIntentRecipient(Wallet.createRandom().address);
              }}
            >
              Preset: Unprotected Recipient
            </button>
          </div>
        </div>

        <p className="muted">
          Test <code>executeScopedAgentIntent</code> against live vault guardrails (`maxTxValue`, daily limit, and{" "}
          <code>0x0A02</code> quantum-safe recipient check).
        </p>

        <div className="grid-3">
          <div className="field">
            <label htmlFor="ex-asset">Asset</label>
            <select
              id="ex-asset"
              value={intentAsset}
              onChange={(e) => setIntentAsset(e.target.value as "QOR" | "fUSD")}
            >
              <option value="QOR">Native QOR</option>
              <option value="fUSD">ERC-20 fUSD</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="ex-amt">Amount</label>
            <input
              id="ex-amt"
              type="number"
              step="0.001"
              min="0"
              value={intentAmount}
              onChange={(e) => setIntentAmount(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="ex-rationale">Intent Rationale</label>
            <input
              id="ex-rationale"
              type="text"
              value={intentRationale}
              onChange={(e) => setIntentRationale(e.target.value)}
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor="ex-recipient">Recipient Address (0x...)</label>
          <input
            id="ex-recipient"
            type="text"
            value={intentRecipient}
            onChange={(e) => setIntentRecipient(e.target.value)}
            placeholder="0x..."
          />
        </div>

        <div className="row-wrap">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleSimulateIntent()}
            disabled={busy !== null}
          >
            {busy === "sim-intent" ? "Simulating..." : "Simulate Payout (Live eth_call)"}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => void handleExecuteIntentOnChain()}
            disabled={busy !== null || !metamask?.connected}
          >
            {busy === "exec-intent" ? "Broadcasting..." : "Execute On-Chain via MetaMask"}
          </button>
        </div>

        {feed.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div className="eyebrow">Real-Time Agent Execution &amp; Blocked-Attack Feed</div>
            <ul className="checklist">
              {feed.map((f) => (
                <li key={f.id} className="check-item attack-reveal">
                  <div>
                    <div className="row-wrap">
                      <span className={`badge ${f.status === "ALLOWED" ? "badge-safe" : "badge-danger"}`}>
                        {f.status === "ALLOWED" ? "✓ Allowed" : "✕ Blocked"}
                      </span>
                      <span className="eyebrow">{f.mode}</span>
                      <strong className="tabular">{f.summary}</strong>
                    </div>
                    <div className="muted" style={{ marginTop: 4 }}>
                      {f.time} · {f.detail}
                    </div>
                  </div>
                  {f.txHash && (
                    <a className="btn" href={explorerTxUrl(f.txHash)} target="_blank" rel="noreferrer">
                      View Receipt
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* 3. Deposit */}
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

      {/* 4. Activity Timeline */}
      <section className="card" aria-labelledby="timeline-heading">
        <div className="row-wrap" style={{ justifyContent: "space-between", marginBottom: 8 }}>
          <h2 id="timeline-heading" style={{ margin: 0 }}>
            On-Chain Activity Timeline
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
