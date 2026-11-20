import { useCallback, useEffect, useState } from "react";
import { isAddress } from "ethers";
import {
  type EvmWindowStatus,
  type PqcStatus,
  type VaultSnapshot,
  checkPqcKeyStatus,
  fetchEvmWindowStatus,
  fetchFusdBalance,
  fetchUserVaults,
  fetchVaultSnapshot,
} from "./lib/chain";
import { DEFAULT_RELAYER_URL, REFERENCE_VAULT_ADDRESS } from "./lib/constants";
import {
  type BrowserKeySigner,
  type EncryptedKeyBackup,
  loadBackupFromIndexedDb,
} from "./lib/signer";
import { getQorexNative, hasCapability } from "@qorechain/qorex-types";
import {
  type QoreXConnection,
  connectMetaMask,
  connectQoreX,
  mapChainError,
} from "./lib/wallets";
import { LandingPage } from "./components/LandingPage";
import { LogoMark } from "./components/LogoMark";
import { LatticeKeyPanel } from "./components/LatticeKeyPanel";
import { CreateVaultPanel } from "./components/CreateVaultPanel";
import { DashboardPanel } from "./components/DashboardPanel";
import { SessionPanel } from "./components/SessionPanel";
import { EmergencyPanel } from "./components/EmergencyPanel";
import { AllowancesPanel } from "./components/AllowancesPanel";
import { AttackLabPanel } from "./components/AgentAndAttackPanels";

type ViewMode = "landing" | "app";
type TabId = "dashboard" | "policy" | "emergency" | "attack";

const APP_TABS: [TabId, string][] = [
  ["dashboard", "Home"],
  ["policy", "Key & Policy"],
  ["emergency", "Kill-Switch"],
  ["attack", "Attack Lab"],
];

export function App() {
  const [mode, setMode] = useState<ViewMode>("landing");
  const [tab, setTab] = useState<TabId>("dashboard");
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const attr = document.documentElement.getAttribute("data-theme");
    return attr === "dark" ? "dark" : "light";
  });

  const [qorex, setQorex] = useState<QoreXConnection | null>(null);
  const [connecting, setConnecting] = useState<boolean>(false);
  const [sessionBusy, setSessionBusy] = useState<boolean>(false);
  const [previewMode, setPreviewMode] = useState<boolean>(false);
  const [pqcStatus, setPqcStatus] = useState<PqcStatus | null>(null);
  const [evmWindow, setEvmWindow] = useState<EvmWindowStatus | null>(null);

  const [storedBackup, setStoredBackup] = useState<EncryptedKeyBackup | null>(null);
  const [unlockedSigner, setUnlockedSigner] = useState<BrowserKeySigner | null>(null);
  const [backupConfirmed, setBackupConfirmed] = useState<boolean>(() => {
    return localStorage.getItem("lw_backup_confirmed") === "true";
  });

  const [userVaults, setUserVaults] = useState<string[]>([]);
  const [vaultsLoadedFor, setVaultsLoadedFor] = useState<string>("");
  const [selectedVaultAddr, setSelectedVaultAddr] = useState<string>("");
  const [vaultSnapshot, setVaultSnapshot] = useState<VaultSnapshot | null>(null);
  const [vaultLoading, setVaultLoading] = useState<boolean>(false);
  const [vaultError, setVaultError] = useState<string | null>(null);
  const [userFusd, setUserFusd] = useState<bigint>(0n);
  const [relayerUrl] = useState<string>(DEFAULT_RELAYER_URL);

  const [toast, setToast] = useState<{ kind: "safe" | "danger"; text: string } | null>(null);

  const showToast = useCallback((kind: "safe" | "danger", text: string) => {
    setToast({ kind, text });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(t);
  }, [toast]);

  const activeAddress = qorex?.evmAddress || "";

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("lw_theme", next);
  };

  useEffect(() => {
    void loadBackupFromIndexedDb().then((b) => {
      if (b) setStoredBackup(b);
    });
  }, []);

  const refreshChainState = useCallback(async () => {
    const vaultTask = (async () => {
      if (!selectedVaultAddr || !isAddress(selectedVaultAddr)) {
        setVaultSnapshot(null);
        setVaultLoading(false);
        setVaultError(null);
        return;
      }
      setVaultLoading(true);
      setVaultError(null);
      try {
        const snap = await fetchVaultSnapshot(selectedVaultAddr);
        setVaultSnapshot(snap);
      } catch (e) {
        setVaultError(mapChainError(e));
      } finally {
        setVaultLoading(false);
      }
    })();

    const accountTask = (async () => {
      if (!activeAddress || !isAddress(activeAddress)) return;
      const [pqcRes, winRes, vaultsRes, fusdRes] = await Promise.allSettled([
        checkPqcKeyStatus(activeAddress),
        fetchEvmWindowStatus(activeAddress, relayerUrl),
        fetchUserVaults(activeAddress),
        fetchFusdBalance(activeAddress),
      ]);
      if (pqcRes.status === "fulfilled") setPqcStatus(pqcRes.value);
      if (winRes.status === "fulfilled") setEvmWindow(winRes.value);
      if (fusdRes.status === "fulfilled") setUserFusd(fusdRes.value.raw);
      if (vaultsRes.status === "fulfilled") {
        const list = vaultsRes.value;
        setUserVaults(list);
        setVaultsLoadedFor(activeAddress.toLowerCase());
        // On first load for this connected wallet, select their own newest vault (never another wallet's vault)
        if (vaultsLoadedFor !== activeAddress.toLowerCase()) {
          if (list.length > 0) {
            setSelectedVaultAddr(list[list.length - 1]);
          } else {
            setSelectedVaultAddr("");
            setVaultSnapshot(null);
          }
        }
      }
    })();

    await Promise.allSettled([vaultTask, accountTask]);
  }, [activeAddress, relayerUrl, selectedVaultAddr, vaultsLoadedFor]);

  useEffect(() => {
    void refreshChainState();
  }, [refreshChainState]);

  const handleConnectMetaMask = async () => {
    if (connecting) return;
    setToast(null);
    setConnecting(true);
    try {
      const conn = await connectMetaMask();
      setQorex(conn);
      setPreviewMode(false);
      setVaultsLoadedFor("");
      setSelectedVaultAddr("");
      setVaultSnapshot(null);
      showToast("safe", `MetaMask connected on QoreChain Diana (${conn.evmAddress.slice(0, 8)}...${conn.evmAddress.slice(-4)}).`);
    } catch (e) {
      showToast("danger", mapChainError(e));
    } finally {
      setConnecting(false);
    }
  };

  const handleConnectQoreX = async () => {
    if (connecting) return;
    setToast(null);
    setConnecting(true);
    try {
      const conn = await connectQoreX();
      setQorex(conn);
      setPreviewMode(false);
      setVaultsLoadedFor("");
      setSelectedVaultAddr("");
      setVaultSnapshot(null);
    } catch (e) {
      showToast("danger", mapChainError(e));
    } finally {
      setConnecting(false);
    }
  };

  const handleOpenWindowInQoreX = async () => {
    setToast(null);
    const native = qorex?.native ?? getQorexNative();
    if (!native || !hasCapability(native, "signAndBroadcast")) {
      showToast("danger", "QoreX native signing is unavailable here. Open the QoreX extension popup and open an EVM window directly.");
      return;
    }
    setSessionBusy(true);
    try {
      await native.enable("qorechain-diana");
      const key = await native.getKey("qorechain-diana");
      const { encodeOpenEvmWindow } = await import("./lib/qorexMsgs");
      const windowMsg = await encodeOpenEvmWindow({
        sender: key.bech32Address,
        blocks: 17280,
        maxTxs: 50,
        maxValueUqor: "50000000",
        allowedTargets: [],
      });
      const res = await native.signAndBroadcast({
        chainId: "qorechain-diana",
        messages: [windowMsg],
        memo: "LatticeWard open 6h EVM session",
      });
      if (typeof res.code === "number" && res.code !== 0) {
        throw new Error(`QoreChain refused the EVM window (code ${res.code}).`);
      }
      showToast("safe", `6h session started via QoreX (${res.txHash.slice(0, 12)}...).`);
      void refreshChainState();
    } catch (e) {
      showToast("danger", mapChainError(e));
    } finally {
      setSessionBusy(false);
    }
  };

  const handleCloseWindowInQoreX = async () => {
    setToast(null);
    const native = qorex?.native ?? getQorexNative();
    if (!native || !hasCapability(native, "signAndBroadcast")) {
      showToast("danger", "QoreX native signing is unavailable here. Close the EVM window directly inside QoreX.");
      return;
    }
    setSessionBusy(true);
    try {
      await native.enable("qorechain-diana");
      const key = await native.getKey("qorechain-diana");
      const { encodeCloseEvmWindow } = await import("./lib/qorexMsgs");
      const closeMsg = await encodeCloseEvmWindow(key.bech32Address);
      const res = await native.signAndBroadcast({
        chainId: "qorechain-diana",
        messages: [closeMsg],
        memo: "LatticeWard close EVM session",
      });
      if (typeof res.code === "number" && res.code !== 0) {
        throw new Error(`QoreChain refused closing the EVM window (code ${res.code}).`);
      }
      showToast("safe", `Session closed via QoreX (${res.txHash.slice(0, 12)}...).`);
      void refreshChainState();
    } catch (e) {
      showToast("danger", mapChainError(e));
    } finally {
      setSessionBusy(false);
    }
  };

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <div className="proto-banner" role="note">
        Testnet prototype — QoreChain Diana (Chain ID 9800). Funds in your vault are protected by post-quantum rules;
        use testnet tokens only.
      </div>

      <header className="site-header">
        <div className="header-inner">
          <div className="row-wrap">
            <button
              type="button"
              className="brand-mark"
              onClick={() => setMode("landing")}
              aria-label="LatticeWard home"
            >
              <LogoMark size={26} />
              <span>LatticeWard</span>
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => setMode(mode === "landing" ? "app" : "landing")}
            >
              {mode === "landing" ? "Open App" : "Overview"}
            </button>
          </div>

          <div className="header-actions">
            {pqcStatus && (
              <span
                className={`badge ${pqcStatus.registered ? "badge-safe" : "badge-danger"}`}
                title={`0x0A02 status for ${pqcStatus.address} (${pqcStatus.qorAddress})`}
              >
                {pqcStatus.registered ? "✓ Quantum-Protected (ML-DSA-87)" : "✕ Unprotected"}
              </span>
            )}
            <button
              type="button"
              className="btn"
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            >
              {theme === "dark" ? "☀ Light" : "☾ Dark"}
            </button>
            {qorex?.connected ? (
              <button
                type="button"
                className="btn btn-primary"
                disabled={connecting}
                onClick={() => void (qorex.walletKind === "metamask" ? handleConnectMetaMask() : handleConnectQoreX())}
              >
                {qorex.walletKind === "metamask"
                  ? `MetaMask: ${qorex.evmAddress.slice(0, 6)}...${qorex.evmAddress.slice(-4)}`
                  : `QoreX: ${qorex.bech32Address.slice(0, 9)}...`}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={connecting}
                  onClick={() => void handleConnectMetaMask()}
                >
                  {connecting ? "Connecting..." : "Connect MetaMask"}
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={connecting}
                  onClick={() => void handleConnectQoreX()}
                >
                  QoreX
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <main id="main-content">
        {mode === "landing" ? (
          <LandingPage
            onOpenApp={() => {
              setMode("app");
              window.scrollTo({ top: 0, behavior: "auto" });
            }}
          />
        ) : (
          <div className="app-layout">
            <aside className="sidebar-nav" aria-label="Vault navigation">
              {APP_TABS.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className="nav-item"
                  aria-current={tab === id ? "page" : undefined}
                  onClick={() => setTab(id)}
                >
                  {label}
                </button>
              ))}
            </aside>

            <div>
              {!qorex?.connected && !previewMode ? (
                <section className="card" aria-labelledby="connect-gate-heading" style={{ textAlign: "center", padding: "40px 24px" }}>
                  <div className="eyebrow">Step 1 of 4 · Connect Wallet</div>
                  <h2 id="connect-gate-heading" style={{ marginTop: 8 }}>
                    Connect Your Wallet to Access Your Vault
                  </h2>
                  <p className="muted" style={{ maxWidth: 480, margin: "8px auto 20px" }}>
                    Connect MetaMask (auto-switches to QoreChain Diana Testnet, Chain ID 9800) or QoreX to manage your
                    post-quantum vault and autonomous AI agent.
                  </p>
                  <div className="row-wrap" style={{ justifyContent: "center" }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={connecting}
                      onClick={() => void handleConnectMetaMask()}
                    >
                      {connecting ? "Connecting..." : "Connect MetaMask"}
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={connecting}
                      onClick={() => void handleConnectQoreX()}
                    >
                      Connect QoreX
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        setPreviewMode(true);
                        setSelectedVaultAddr(REFERENCE_VAULT_ADDRESS);
                      }}
                    >
                      Preview Live Vault (Read-Only)
                    </button>
                  </div>
                </section>
              ) : (
                <>
                  {/* Slim Vault & Key Context Bar */}
                  <div className="vault-bar" role="region" aria-label="Active vault and key status">
                    <div className="vault-bar-select">
                      <label htmlFor="vault-select" className="eyebrow" style={{ whiteSpace: "nowrap" }}>
                        Vault
                      </label>
                      <select
                        id="vault-select"
                        value={selectedVaultAddr}
                        onChange={(e) => setSelectedVaultAddr(e.target.value)}
                      >
                        {userVaults.length === 0 && !selectedVaultAddr && (
                          <option value="">No personal vault yet</option>
                        )}
                        {userVaults.map((v, i) => (
                          <option key={v} value={v}>
                            My Vault #{i + 1} ({v.slice(0, 8)}...{v.slice(-4)})
                          </option>
                        ))}
                        <option value={REFERENCE_VAULT_ADDRESS}>
                          Live Demo Vault ({REFERENCE_VAULT_ADDRESS.slice(0, 8)}...{REFERENCE_VAULT_ADDRESS.slice(-4)})
                        </option>
                      </select>
                    </div>
                    <div className="row-wrap">
                      {evmWindow?.status === "closed" && (
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={() => void handleOpenWindowInQoreX()}
                          title="Open a scoped EVM window in QoreX so you can send EVM transactions"
                        >
                          Open EVM Window
                        </button>
                      )}
                      <button
                        type="button"
                        className={`badge ${unlockedSigner ? "badge-safe" : "badge-caution"}`}
                        style={{ cursor: "pointer", fontFamily: "inherit" }}
                        onClick={() => setTab("policy")}
                        title="Manage your ML-DSA-87 Lattice Key"
                      >
                        {unlockedSigner ? "✓ Lattice Key Unlocked" : "🔒 Lattice Key Locked"}
                      </button>
                      <button type="button" className="btn" onClick={() => void refreshChainState()}>
                        Sync
                      </button>
                    </div>
                  </div>

                  {tab === "dashboard" && (
                    <>
                      {/* Guided 4-Step Consumer Strip */}
                      <div className="step-strip" aria-label="Quick setup steps">
                        <button
                          type="button"
                          className={`step-pill ${qorex?.connected ? "done" : ""}`}
                          onClick={() => void handleConnectMetaMask()}
                        >
                          <span className="step-pill-num">Step 1 · {qorex?.connected ? "Done" : "Read-Only"}</span>
                          <span className="step-pill-title">
                            {qorex?.walletKind === "qorex" ? "QoreX Connected" : "Connect Wallet"}
                          </span>
                          <span className="step-pill-sub">
                            {qorex?.connected
                              ? qorex.walletKind === "metamask"
                                ? `MetaMask ${qorex.evmAddress.slice(0, 8)}...`
                                : `${qorex.bech32Address.slice(0, 10)}...`
                              : "MetaMask or QoreX"}
                          </span>
                        </button>

                        <button
                          type="button"
                          className={`step-pill ${unlockedSigner ? "done" : ""}`}
                          onClick={() => setTab("policy")}
                        >
                          <span className="step-pill-num">Step 2 · {unlockedSigner ? "Done" : "Set up"}</span>
                          <span className="step-pill-title">Create Lattice Key</span>
                          <span className="step-pill-sub">
                            {unlockedSigner ? "ML-DSA-87 unlocked" : "Quantum-safe owner key"}
                          </span>
                        </button>

                        <button
                          type="button"
                          className={`step-pill ${vaultSnapshot && !vaultSnapshot.frozen ? "done" : ""}`}
                          onClick={() => setTab("policy")}
                        >
                          <span className="step-pill-num">
                            Step 3 · {vaultSnapshot ? "Active" : "Configure"}
                          </span>
                          <span className="step-pill-title">Set Policy</span>
                          <span className="step-pill-sub">
                            {vaultSnapshot
                              ? `Firewall ${vaultSnapshot.requireRecipientPqc ? "ON" : "OFF"} · Daily caps`
                              : "Daily limits & firewall"}
                          </span>
                        </button>

                        <button
                          type="button"
                          className={`step-pill ${vaultSnapshot && !vaultSnapshot.frozen ? "done" : ""}`}
                          onClick={() => {
                            document.getElementById("executor-heading")?.scrollIntoView({ behavior: "smooth" });
                          }}
                        >
                          <span className="step-pill-num">Step 4 · Live</span>
                          <span className="step-pill-title">Agent Works</span>
                          <span className="step-pill-sub">Autonomous within your rules</span>
                        </button>
                      </div>

                      {!selectedVaultAddr ? (
                        <section className="card" style={{ textAlign: "center", padding: "32px 24px" }}>
                          <div className="eyebrow">Your Personal Vault</div>
                          <h2 style={{ marginTop: 8 }}>You Haven&apos;t Created a Vault Yet</h2>
                          <p className="muted" style={{ maxWidth: 480, margin: "8px auto 20px" }}>
                            Create your own isolated vault in <strong>Key &amp; Policy</strong> so your Lattice Key owns
                            it and your agent can execute payments under your rules.
                          </p>
                          <div className="row-wrap" style={{ justifyContent: "center" }}>
                            <button type="button" className="btn btn-primary" onClick={() => setTab("policy")}>
                              Create My Vault
                            </button>
                            <button
                              type="button"
                              className="btn"
                              onClick={() => setSelectedVaultAddr(REFERENCE_VAULT_ADDRESS)}
                            >
                              Inspect Live Demo Vault
                            </button>
                          </div>
                        </section>
                      ) : (
                        <>
                          <DashboardPanel
                            vault={vaultSnapshot}
                            vaultLoading={vaultLoading}
                            vaultError={vaultError}
                            qorex={qorex}
                            userFusdBalance={userFusd}
                            onNotify={showToast}
                            onRefresh={() => void refreshChainState()}
                            onGoEmergency={() => setTab("emergency")}
                          />
                          <SessionPanel
                            evmWindow={evmWindow}
                            vault={vaultSnapshot}
                            busy={sessionBusy}
                            onStartSession={() => void handleOpenWindowInQoreX()}
                            onStopSession={() => void handleCloseWindowInQoreX()}
                          />
                        </>
                      )}
                    </>
                  )}

                  {tab === "policy" && (
                    <>
                      <LatticeKeyPanel
                        storedBackup={storedBackup}
                        unlockedSigner={unlockedSigner}
                        backupConfirmed={backupConfirmed}
                        onUnlocked={(signer, backup) => {
                          setUnlockedSigner(signer);
                          setStoredBackup(backup);
                        }}
                        onBackupConfirmed={() => {
                          setBackupConfirmed(true);
                          localStorage.setItem("lw_backup_confirmed", "true");
                        }}
                        onCleared={() => {
                          setUnlockedSigner(null);
                          setStoredBackup(null);
                          setBackupConfirmed(false);
                          localStorage.removeItem("lw_backup_confirmed");
                        }}
                      />

                      <AllowancesPanel
                        vault={vaultSnapshot}
                        qorex={qorex}
                        unlockedSigner={unlockedSigner}
                        relayerUrl={relayerUrl}
                        onRefresh={() => void refreshChainState()}
                      />

                      <details className="disclosure-card" open={userVaults.length === 0}>
                        <summary>Deploy Your Own Isolated Vault {userVaults.length === 0 ? "(Recommended)" : "(Optional)"}</summary>
                        <div className="disclosure-body" style={{ paddingTop: 16 }}>
                          <CreateVaultPanel
                            qorex={qorex}
                            unlockedSigner={unlockedSigner}
                            backupConfirmed={backupConfirmed}
                            onVaultCreated={(addr) => {
                              setUserVaults((prev) => (prev.some((v) => v.toLowerCase() === addr.toLowerCase()) ? prev : [...prev, addr]));
                              setSelectedVaultAddr(addr);
                              setTab("dashboard");
                              showToast("safe", `Your new vault (${addr.slice(0, 10)}...) is live!`);
                            }}
                          />
                        </div>
                      </details>
                    </>
                  )}

                  {tab === "emergency" && (
                    <>
                      {!unlockedSigner && (
                        <LatticeKeyPanel
                          storedBackup={storedBackup}
                          unlockedSigner={unlockedSigner}
                          backupConfirmed={backupConfirmed}
                          onUnlocked={(signer, backup) => {
                            setUnlockedSigner(signer);
                            setStoredBackup(backup);
                          }}
                          onBackupConfirmed={() => {
                            setBackupConfirmed(true);
                            localStorage.setItem("lw_backup_confirmed", "true");
                          }}
                          onCleared={() => {
                            setUnlockedSigner(null);
                            setStoredBackup(null);
                            setBackupConfirmed(false);
                            localStorage.removeItem("lw_backup_confirmed");
                          }}
                        />
                      )}
                      <EmergencyPanel
                        vault={vaultSnapshot}
                        qorex={qorex}
                        unlockedSigner={unlockedSigner}
                        evmWindow={evmWindow}
                        relayerUrl={relayerUrl}
                        onOpenWindowInQoreX={() => void handleOpenWindowInQoreX()}
                        onRefresh={() => void refreshChainState()}
                      />
                    </>
                  )}

                  {tab === "attack" && <AttackLabPanel vault={vaultSnapshot} />}
                </>
              )}
            </div>
          </div>
        )}
      </main>

      {toast && (
        <div className="toast-container" aria-live="polite">
          <div className={`toast ${toast.kind === "safe" ? "toast-safe" : "toast-danger"}`} role="status">
            <span>{toast.text}</span>
            <button
              type="button"
              className="toast-close"
              aria-label="Dismiss notification"
              onClick={() => setToast(null)}
            >
              ×
            </button>
          </div>
        </div>
      )}

      {mode === "app" && (
        <nav className="bottom-nav" aria-label="Mobile vault navigation">
          {APP_TABS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className="bottom-nav-btn"
              aria-current={tab === id ? "page" : undefined}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
      )}
    </>
  );
}
