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
  EVM_RPC_URL,
  FUSD_ADDRESS,
  FUSD_BANK_DENOM,
  VAULT_ABI,
  ZERO_ADDRESS,
  explorerAddrUrl,
  explorerTxUrl,
} from "../lib/constants";
import { getReadProvider, resolveCosmosTxHash, type VaultSnapshot } from "../lib/chain";
import { evmToQor, mapChainError, type QoreXConnection } from "../lib/wallets";

interface Props {
  vault: VaultSnapshot | null;
  vaultLoading?: boolean;
  vaultError?: string | null;
  qorex: QoreXConnection | null;
  userFusdBalance: bigint;
  onNotify?: (kind: "safe" | "danger", text: string) => void;
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
  vaultLoading,
  vaultError,
  qorex,
  userFusdBalance,
  onNotify,
  onRefresh,
  onGoEmergency,
}: Props) {
  const [depositQor, setDepositQor] = useState("");
  const [depositFusd, setDepositFusd] = useState("");
  const [intentAsset, setIntentAsset] = useState<"QOR" | "fUSD">("QOR");
  const [intentAmount, setIntentAmount] = useState("");
  const [intentRecipient, setIntentRecipient] = useState("");
  const [intentRationale, setIntentRationale] = useState("");
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [mcpCopied, setMcpCopied] = useState(false);
  const setErr = (t: string | null) => {
    if (t) onNotify?.("danger", t);
  };
  const setMsg = (t: string | null) => {
    if (t) onNotify?.("safe", t);
  };

  if (!vault) {
    return (
      <section className="card">
        <h2>{vaultLoading ? "Syncing Live Vault..." : vaultError ? "RPC Sync Error" : "No Vault Selected"}</h2>
        <p className="muted">
          {vaultLoading
            ? "Reading Treasury & Guardrail State from QoreChain Diana Testnet (Chain ID 9800)..."
            : vaultError
              ? `Could not load vault telemetry from QoreChain RPC: ${vaultError}`
              : "Create your first isolated vault from Create Vault, or pick the Live Deployed Vault above."}
        </p>
        {!vaultLoading && (
          <button type="button" className="btn btn-primary" style={{ marginTop: 12 }} onClick={onRefresh}>
            Retry Sync
          </button>
        )}
      </section>
    );
  }

  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  const isAgentWallet =
    !!qorex?.evmProvider && !!qorex.evmAddress && qorex.evmAddress.toLowerCase() === vault.agentKey.toLowerCase();
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
    if (!qorex?.evmProvider) {
      setErr("Connect QoreX first so we can send your QOR deposit.");
      return;
    }
    if (!depositQor || Number(depositQor) <= 0) {
      setErr("Enter a QOR amount to deposit.");
      return;
    }
    setBusy("deposit-qor");
    try {
      const signer = await qorex.evmProvider.getSigner();
      const tx = await signer.sendTransaction({ to: vault.address, value: parseEther(depositQor) });
      await tx.wait(1, 120_000);
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
    if (!qorex?.evmProvider) {
      setErr("Connect QoreX first so we can send your fUSD deposit.");
      return;
    }
    if (!depositFusd || Number(depositFusd) <= 0) {
      setErr("Enter an fUSD amount to deposit.");
      return;
    }
    setBusy("deposit-fusd");
    try {
      const signer = await qorex.evmProvider.getSigner();
      const fusd = new Contract(FUSD_ADDRESS, ERC20_ABI, signer);
      const tx = await fusd.transfer(vault.address, parseUnits(depositFusd, vault.fusdDecimals));
      await tx.wait(1, 120_000);
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
    if (!intentAmount || Number(intentAmount) <= 0) {
      throw new Error("Enter a payout amount greater than 0.");
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
    if (!qorex?.evmProvider) {
      setErr("Connect QoreX (using the vault's active agentKey) to broadcast an on-chain agent payout.");
      return;
    }
    setBusy("exec-intent");
    try {
      const env = buildIntentTuple();
      const signer = await qorex.evmProvider.getSigner();
      const contract = new Contract(vault.address, VAULT_ABI, signer);
      const tx = await contract.executeScopedAgentIntent(env);
      await tx.wait(1, 120_000);
      const explorerHash = await resolveCosmosTxHash(tx.hash);
      setFeed((prev) => [
        {
          id: tx.hash,
          time: new Date().toLocaleTimeString(),
          mode: "ON-CHAIN",
          status: "ALLOWED",
          summary: `${intentAmount} ${intentAsset} -> ${intentRecipient.slice(0, 10)}...`,
          detail: "Committed on QoreChain Diana Testnet",
          txHash: explorerHash,
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
      {/* 1. Clean Vault Balance & Guardrail Summary */}
      <section className="card" aria-labelledby="dash-heading">
        <div className="row-wrap" style={{ justifyContent: "space-between", marginBottom: 12 }}>
          <div>
            <div className="eyebrow">Your Protected Vault</div>
            <h2 id="dash-heading" style={{ marginTop: 4 }}>
              Balance &amp; Daily Limits
            </h2>
          </div>
          <div className="row-wrap">
            <span className={`badge ${vault.frozen ? "badge-danger" : "badge-safe"}`}>
              {vault.frozen ? "❄ Paused" : "● Agent Active"}
            </span>
            <span className={`badge ${vault.requireRecipientPqc ? "badge-safe" : "badge-caution"}`}>
              {vault.requireRecipientPqc ? "✓ Quantum Firewall ON" : "⚠ Firewall OFF"}
            </span>
            <button type="button" className="btn btn-destructive" onClick={onGoEmergency}>
              Kill-Switch
            </button>
          </div>
        </div>

        <div className="grid-2" style={{ marginTop: 12 }}>
          <div className="diff-box" style={{ margin: 0 }}>
            <div className="eyebrow">QOR Balance</div>
            <div className="big-metric tabular" style={{ marginTop: 6 }}>
              {formatEther(vault.qorBalance)} QOR
            </div>
            <div className="muted tabular" style={{ marginTop: 8 }}>
              Left today: <strong>{qorRem}</strong> / {qorDay} QOR · Max {qorTx} QOR/tx
            </div>
          </div>

          <div className="diff-box" style={{ margin: 0 }}>
            <div className="eyebrow">fUSD Balance</div>
            <div className="big-metric tabular" style={{ marginTop: 6 }}>
              {formatUnits(vault.fusdBalance, vault.fusdDecimals)} fUSD
            </div>
            <div className="muted tabular" style={{ marginTop: 8 }}>
              Left today: <strong>{fusdRem}</strong> / {fusdDay} fUSD · Max {fusdTx} fUSD/tx
            </div>
          </div>
        </div>
      </section>

      {/* 2. Simple Agent Payment Runner */}
      <section className="card" aria-labelledby="executor-heading">
        <div className="row-wrap" style={{ justifyContent: "space-between", marginBottom: 8 }}>
          <div>
            <div className="eyebrow">Autonomous Agent</div>
            <h2 id="executor-heading" style={{ marginTop: 4 }}>
              Test or Run an Agent Payment
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
              Valid Payout
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
              Try Over-Spend
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
              Unprotected Wallet
            </button>
          </div>
        </div>

        <p className="muted">
          Your agent can only spend within your daily caps and only to quantum-protected wallets. Try a normal payout
          or test an attack below.
        </p>

        <div className="grid-3">
          <div className="field">
            <label htmlFor="ex-asset">Asset</label>
            <select
              id="ex-asset"
              value={intentAsset}
              onChange={(e) => setIntentAsset(e.target.value as "QOR" | "fUSD")}
            >
              <option value="QOR">QOR</option>
              <option value="fUSD">fUSD</option>
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
              placeholder={intentAsset === "QOR" ? "e.g. 0.002" : "e.g. 0.5"}
            />
          </div>
          <div className="field">
            <label htmlFor="ex-rationale">Note</label>
            <input
              id="ex-rationale"
              type="text"
              value={intentRationale}
              onChange={(e) => setIntentRationale(e.target.value)}
              placeholder="e.g. Scoped AI agent settlement"
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
            placeholder="0xD6891e4Ef67be07b5DE9703Dcc4cf36eF4D15aae"
          />
        </div>

        <div className="row-wrap">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleSimulateIntent()}
            disabled={busy !== null}
          >
            {busy === "sim-intent" ? "Checking..." : "Test Against Policy"}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => void handleExecuteIntentOnChain()}
            disabled={busy !== null || !isAgentWallet}
            title={
              isAgentWallet
                ? "Broadcast this payout on-chain from the agent wallet"
                : "Only the vault's agent wallet can send payouts. Use Test Against Policy to check a payout."
            }
          >
            {busy === "exec-intent" ? "Sending..." : "Send via QoreX"}
          </button>
        </div>
        {!isAgentWallet && (
          <p className="muted" style={{ marginTop: 8, marginBottom: 0 }}>
            Only the vault&apos;s agent wallet ({vault.agentKey.slice(0, 8)}...{vault.agentKey.slice(-4)}) can send
            payouts. <strong>Test Against Policy</strong> checks any payout live on QoreChain without signing.
          </p>
        )}

        {feed.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div className="eyebrow">Recent Checks</div>
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

      {/* 2.5 Collapsible Connect AI Agent (MCP / Bot) Drawer */}
      <details className="disclosure-card">
        <summary>Connect an AI Agent (Claude / Cursor / MCP Bot)</summary>
        <div className="disclosure-body" style={{ paddingTop: 16 }}>
          <p className="muted" style={{ marginTop: 0 }}>
            Plug any MCP-compatible AI agent into this vault so it can autonomously pay vendors or APIs from your
            deposited QOR &amp; fUSD balance — strictly bounded by your daily caps and <code>0x0A02</code> quantum
            firewall.
          </p>
          <div className="diff-box" style={{ marginBottom: 12 }}>
            <div className="eyebrow">Authorized Agent Wallet for This Vault</div>
            <div className="mono" style={{ marginTop: 4 }}>
              {vault.agentKey}
            </div>
            <div className="mono muted">{evmToQor(vault.agentKey)}</div>
          </div>
          <div className="row-wrap" style={{ justifyContent: "space-between", marginBottom: 8 }}>
            <strong>Copy-ready MCP Config (Claude Desktop / Cursor)</strong>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                const snippet = JSON.stringify(
                  {
                    mcpServers: {
                      latticeward: {
                        command: "npx",
                        args: ["tsx", "packages/agent-mcp/src/mcp-server.ts"],
                        env: {
                          QOR_EVM_RPC: EVM_RPC_URL,
                          VAULT_ADDRESS: vault.address,
                          FUSD_ADDRESS,
                          AGENT_PRIVATE_KEY: "<private-key-for-" + vault.agentKey.slice(0, 8) + "...>",
                        },
                      },
                    },
                  },
                  null,
                  2,
                );
                void navigator.clipboard.writeText(snippet);
                setMcpCopied(true);
                setMsg("MCP config copied to clipboard.");
                window.setTimeout(() => setMcpCopied(false), 2000);
              }}
            >
              {mcpCopied ? "✓ Copied!" : "Copy MCP Config"}
            </button>
          </div>
          <pre className="diff-box mono" style={{ overflowX: "auto", margin: 0 }}>
            {JSON.stringify(
              {
                mcpServers: {
                  latticeward: {
                    command: "npx",
                    args: ["tsx", "packages/agent-mcp/src/mcp-server.ts"],
                    env: {
                      QOR_EVM_RPC: EVM_RPC_URL,
                      VAULT_ADDRESS: vault.address,
                      FUSD_ADDRESS,
                      AGENT_PRIVATE_KEY: "<private-key-for-" + vault.agentKey.slice(0, 8) + "...>",
                    },
                  },
                },
              },
              null,
              2,
            )}
          </pre>
        </div>
      </details>

      {/* 3. Collapsible Deposit Drawer */}
      <details className="disclosure-card">
        <summary>Deposit Funds into Vault (QOR &amp; fUSD)</summary>
        <div className="disclosure-body" style={{ paddingTop: 16 }}>
          <div className="grid-2">
            <form onSubmit={handleDepositQor}>
              <div className="field">
                <label htmlFor="dep-qor">QOR amount</label>
                <input
                  id="dep-qor"
                  type="number"
                  step="0.01"
                  min="0.001"
                  value={depositQor}
                  onChange={(e) => setDepositQor(e.target.value)}
                  placeholder="e.g. 0.25"
                />
              </div>
              <button type="submit" className="btn btn-primary" disabled={busy !== null || !qorex?.evmProvider}>
                {busy === "deposit-qor" ? "Sending..." : "Deposit QOR"}
              </button>
            </form>

            {userFusdBalance > 0n ? (
              <form onSubmit={handleDepositFusd}>
                <div className="field">
                  <label htmlFor="dep-fusd">
                    fUSD (you hold {formatUnits(userFusdBalance, vault.fusdDecimals)} fUSD)
                  </label>
                  <input
                    id="dep-fusd"
                    type="number"
                    step="0.1"
                    min="0.1"
                    value={depositFusd}
                    onChange={(e) => setDepositFusd(e.target.value)}
                    placeholder="e.g. 5"
                  />
                </div>
                <button type="submit" className="btn btn-primary" disabled={busy !== null || !qorex?.evmProvider}>
                  {busy === "deposit-fusd" ? "Sending..." : "Deposit fUSD"}
                </button>
              </form>
            ) : (
              <div className="alert alert-caution" style={{ margin: 0 }}>
                <strong>0 ERC-20 fUSD in QoreX EVM.</strong> Faucet fUSD starts as a Cosmos bank coin (
                <span className="mono">{FUSD_BANK_DENOM}</span>). Convert it to ERC-20 fUSD via QoreX before
                depositing.
              </div>
            )}
          </div>
        </div>
      </details>

      {/* 4. Collapsible Protocol Proofs & Technical Telemetry (for auditors & judges) */}
      <details className="disclosure-card">
        <summary>Protocol Proofs, x/abstractaccount &amp; On-Chain Activity</summary>
        <div className="disclosure-body" style={{ paddingTop: 16 }}>
          <div className="row-wrap" style={{ justifyContent: "space-between", marginBottom: 12 }}>
            <div>
              <div className="mono muted">Vault EVM: {vault.address}</div>
              <div className="mono muted">Vault Native: {vault.qorAddress}</div>
            </div>
            <a href={explorerAddrUrl(vault.address)} target="_blank" rel="noreferrer">
              Open on Explorer
            </a>
          </div>

          <div className="grid-3" style={{ marginBottom: 16 }}>
            <div className="diff-box" style={{ margin: 0 }}>
              <div className="eyebrow">Vault Telemetry</div>
              <div className="tabular" style={{ marginTop: 8 }}>
                <strong>Policy Nonce:</strong> <code>{vault.policyNonce.toString()}</code>
              </div>
              <div className="tabular" style={{ marginTop: 4 }}>
                <strong>Epoch:</strong> <span className="muted">{Math.round(vault.epochDuration / 3600)}h rolling</span>
              </div>
              <div style={{ marginTop: 6 }}>
                <strong>Agent Key:</strong>
                <div className="mono muted">{vault.agentKey}</div>
                <div className="mono muted">{evmToQor(vault.agentKey)}</div>
              </div>
              <div style={{ marginTop: 6 }}>
                <strong>Lattice Key Hash:</strong>
                <div className="mono muted">{vault.sovereignKeyHash.slice(0, 18)}...</div>
              </div>
            </div>

            <div className="diff-box" style={{ margin: 0 }}>
              <div className="eyebrow">Layer 1 · x/abstractaccount</div>
              <div className="tabular" style={{ marginTop: 8 }}>
                <strong>Rule:</strong> <code>latticeward-vault-only</code>
              </div>
              <div className="tabular" style={{ marginTop: 4 }}>
                <strong>uqor:</strong> <code>100k/tx</code> · <code>300k/day</code>
              </div>
              <div className="tabular" style={{ marginTop: 4 }}>
                <strong>Bank fUSD:</strong> <code>1M/tx</code> · <code>3M/day</code>
              </div>
              <div className="tabular" style={{ marginTop: 4 }}>
                <strong>Permissions:</strong> <code>[&quot;evm&quot;, &quot;send&quot;]</code> (30d TTL)
              </div>
            </div>

            <div className="diff-box" style={{ margin: 0 }}>
              <div className="eyebrow">Live Testnet Proofs (9800)</div>
              <div className="tabular" style={{ marginTop: 8 }}>
                <strong>AA Rules:</strong>{" "}
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
                <strong>Drill Closed:</strong>{" "}
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
                <strong>MsgExecuteEVM:</strong>{" "}
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
                <strong>Revoke Proof:</strong>{" "}
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

          <div style={{ marginTop: 12 }}>
            <div className="eyebrow">On-Chain Activity Timeline</div>
            {vault.events.length === 0 ? (
              <p className="muted" style={{ marginTop: 8, marginBottom: 0 }}>
                No recent vault events in the last 50,000 blocks.
              </p>
            ) : (
              <ul className="checklist" style={{ marginTop: 8 }}>
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
          </div>
        </div>
      </details>
    </div>
  );
}
