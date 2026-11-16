import type { EvmWindowStatus, PqcStatus, VaultSnapshot } from "../lib/chain";
import type { MetaMaskConnection, QoreXConnection } from "../lib/wallets";

interface Props {
  qorex: QoreXConnection | null;
  metamask: MetaMaskConnection | null;
  pqcStatus: PqcStatus | null;
  evmWindow: EvmWindowStatus | null;
  hasVault: boolean;
  vault: VaultSnapshot | null;
  onConnectQoreX: () => void;
  onConnectMetaMask: () => void;
  onOpenWindowInQoreX: () => void;
  onGoTab: (tab: "create" | "deposit" | "allowances") => void;
}

export function SetupChecklist({
  qorex,
  metamask,
  pqcStatus,
  evmWindow,
  hasVault,
  vault,
  onConnectQoreX,
  onConnectMetaMask,
  onOpenWindowInQoreX,
  onGoTab,
}: Props) {
  const walletConnected = Boolean(metamask?.connected || qorex?.connected);
  const keyRegistered = Boolean(pqcStatus?.registered);
  const windowOpen = evmWindow?.status === "open";
  const hasDeposit = Boolean(vault && (vault.qorBalance > 0n || vault.fusdBalance > 0n));
  const hasAllowance = Boolean(vault && (vault.qorLimit.enabled || vault.fusdLimit.enabled));

  const steps = [
    {
      id: "connect",
      done: walletConnected && Boolean(metamask?.connected),
      title: "1. Connect QoreX & MetaMask",
      why: "QoreX manages your post-quantum identity and EVM window; MetaMask sends EVM transactions on chain 9800.",
      actionLabel: !qorex?.connected ? "Connect QoreX" : !metamask?.connected ? "Connect MetaMask" : "Connected",
      onAction: !qorex?.connected ? onConnectQoreX : onConnectMetaMask,
      disabled: Boolean(qorex?.connected && metamask?.connected),
    },
    {
      id: "key",
      done: keyRegistered,
      title: "2. Post-quantum key registered (0x0A02)",
      why: "QoreChain only admits EVM transactions from accounts with a registered ML-DSA-87 key.",
      actionLabel: keyRegistered ? "Registered" : "Register in QoreX",
      onAction: onConnectQoreX,
      disabled: keyRegistered,
    },
    {
      id: "window",
      done: windowOpen,
      title: "3. EVM authorization window open",
      why: "Your EVM window bounds how many blocks, transactions, and uqor MetaMask can spend (~6h max).",
      actionLabel: windowOpen ? "Window Open" : "Open Window in QoreX",
      onAction: onOpenWindowInQoreX,
      disabled: windowOpen || !qorex?.canSignAndBroadcast,
    },
    {
      id: "vault",
      done: hasVault,
      title: "4. Create your isolated vault",
      why: "Deploys your own LatticeWardVault from VaultFactory. Funds in your vault are protected by your Lattice key.",
      actionLabel: hasVault ? "Vault Created" : "Create Vault",
      onAction: () => onGoTab("create"),
      disabled: false,
    },
    {
      id: "deposit",
      done: hasDeposit,
      title: "5. Deposit QOR or ERC-20 fUSD",
      why: "Only funds inside your vault are governed by daily limits, the quantum-safety firewall, and emergency freeze.",
      actionLabel: hasDeposit ? "Funded" : "Deposit Funds",
      onAction: () => onGoTab("deposit"),
      disabled: !hasVault,
    },
    {
      id: "allowance",
      done: hasAllowance,
      title: "6. Review your daily allowance",
      why: "Caps how much your hot agent key can spend per payment and per day, even if the agent key leaks.",
      actionLabel: hasAllowance ? "Review Allowances" : "Set Allowance",
      onAction: () => onGoTab("allowances"),
      disabled: !hasVault,
    },
  ];

  const completed = steps.filter((s) => s.done).length;
  const pct = Math.round((completed / steps.length) * 100);

  return (
    <section className="card" aria-labelledby="checklist-heading">
      <div className="row-wrap" style={{ justifyContent: "space-between", marginBottom: 8 }}>
        <h2 id="checklist-heading" style={{ margin: 0 }}>
          Setup Checklist ({completed}/{steps.length})
        </h2>
        <span className="muted">{pct}% complete</span>
      </div>
      <div className="progress-track" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>

      {evmWindow?.status === "cors_blocked" && (
        <div className="alert alert-warn" style={{ marginTop: 12 }}>
          <strong>EVM window check note:</strong> {evmWindow.message}
        </div>
      )}

      <ul className="checklist">
        {steps.map((s) => (
          <li key={s.id} className="check-item">
            <div>
              <div className="row-wrap">
                <span className={`badge ${s.done ? "badge-active" : "badge-warn"}`}>
                  {s.done ? "✓ Done" : "○ Pending"}
                </span>
                <strong>{s.title}</strong>
              </div>
              <p className="muted" style={{ margin: "4px 0 0" }}>
                {s.why}
              </p>
            </div>
            <button type="button" className="btn" onClick={s.onAction} disabled={s.disabled}>
              {s.actionLabel}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
