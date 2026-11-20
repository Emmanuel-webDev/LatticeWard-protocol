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
import { DEFAULT_RELAYER_URL, FACTORY_ADDRESS, FUSD_ADDRESS, REFERENCE_VAULT_ADDRESS } from "./lib/constants";
import {
  type BrowserKeySigner,
  type EncryptedKeyBackup,
  loadBackupFromIndexedDb,
} from "./lib/signer";
import {
  type QoreXConnection,
  connectQoreX,
  evmToQor,
  mapChainError,
} from "./lib/wallets";
import { LandingPage } from "./components/LandingPage";
import { LogoMark } from "./components/LogoMark";
import { LatticeKeyPanel } from "./components/LatticeKeyPanel";
import { SetupChecklist } from "./components/SetupChecklist";
import { CreateVaultPanel } from "./components/CreateVaultPanel";
import { DashboardPanel } from "./components/DashboardPanel";
import { EmergencyPanel } from "./components/EmergencyPanel";
import { AllowancesPanel } from "./components/AllowancesPanel";
import { AgentAccountPanel, AttackLabPanel, GlossaryPanel } from "./components/AgentAndAttackPanels";

type ViewMode = "landing" | "app";
type TabId = "setup" | "dashboard" | "create" | "allowances" | "agent" | "emergency" | "attack" | "glossary";

const APP_TABS: [TabId, string][] = [
  ["setup", "Setup"],
  ["dashboard", "Dashboard"],
  ["create", "Create Vault"],
  ["allowances", "Guardrails"],
  ["agent", "Agent"],
  ["emergency", "Kill-Switch"],
  ["attack", "Attack Lab"],
  ["glossary", "Glossary"],
];

export function App() {
  const [mode, setMode] = useState<ViewMode>("landing");
  const [tab, setTab] = useState<TabId>("dashboard");
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const attr = document.documentElement.getAttribute("data-theme");
    return attr === "dark" ? "dark" : "light";
  });

  const [qorex, setQorex] = useState<QoreXConnection | null>(null);
  const [pqcStatus, setPqcStatus] = useState<PqcStatus | null>(null);
  const [evmWindow, setEvmWindow] = useState<EvmWindowStatus | null>(null);

  const [storedBackup, setStoredBackup] = useState<EncryptedKeyBackup | null>(null);
  const [unlockedSigner, setUnlockedSigner] = useState<BrowserKeySigner | null>(null);
  const [backupConfirmed, setBackupConfirmed] = useState<boolean>(() => {
    return localStorage.getItem("lw_backup_confirmed") === "true";
  });

  const [userVaults, setUserVaults] = useState<string[]>([]);
  const [selectedVaultAddr, setSelectedVaultAddr] = useState<string>(REFERENCE_VAULT_ADDRESS);
  const [vaultSnapshot, setVaultSnapshot] = useState<VaultSnapshot | null>(null);
  const [userFusd, setUserFusd] = useState<bigint>(0n);
  const [relayerUrl] = useState<string>(DEFAULT_RELAYER_URL);

  const [walletErr, setWalletErr] = useState<string | null>(null);
  const [walletInfo, setWalletInfo] = useState<string | null>(null);

  const activeAddress = qorex?.evmAddress || "";
  const activeQorAddress = qorex?.bech32Address || (activeAddress ? evmToQor(activeAddress) : "");

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
    try {
      if (selectedVaultAddr && isAddress(selectedVaultAddr)) {
        const snap = await fetchVaultSnapshot(selectedVaultAddr);
        setVaultSnapshot(snap);
      } else {
        setVaultSnapshot(null);
      }
      if (activeAddress && isAddress(activeAddress)) {
        const [pqc, win, vaults, fusd] = await Promise.all([
          checkPqcKeyStatus(activeAddress),
          fetchEvmWindowStatus(activeAddress, relayerUrl),
          fetchUserVaults(activeAddress),
          fetchFusdBalance(activeAddress),
        ]);
        setPqcStatus(pqc);
        setEvmWindow(win);
        setUserVaults(vaults);
        setUserFusd(fusd.raw);
        if (vaults.length > 0 && selectedVaultAddr === REFERENCE_VAULT_ADDRESS) {
          const newest = vaults[vaults.length - 1];
          setSelectedVaultAddr(newest);
          setVaultSnapshot(await fetchVaultSnapshot(newest));
        }
      }
    } catch {
      // keep existing UI state on transient RPC error
    }
  }, [activeAddress, relayerUrl, selectedVaultAddr]);

  useEffect(() => {
    void refreshChainState();
  }, [refreshChainState]);

  const handleConnectQoreX = async () => {
    setWalletErr(null);
    setWalletInfo(null);
    try {
      const conn = await connectQoreX();
      setQorex(conn);
      setWalletInfo(`QoreX connected: ${conn.bech32Address} (${conn.evmAddress})`);
    } catch (e) {
      setWalletErr(mapChainError(e));
    }
  };

  const handleOpenWindowInQoreX = async () => {
    setWalletErr(null);
    setWalletInfo(null);
    if (!qorex?.native || !qorex.canSignAndBroadcast) {
      setWalletErr("Open the QoreX extension or mobile app and open your EVM window from the EVM Window panel.");
      return;
    }
    try {
      const targetVault = selectedVaultAddr && isAddress(selectedVaultAddr) ? selectedVaultAddr : REFERENCE_VAULT_ADDRESS;
      const res = await qorex.native.signAndBroadcast({
        chainId: "qorechain-diana",
        messages: [
          {
            typeUrl: "/qorechain.pqc.v1.MsgOpenEVMWindow",
            value: {
              sender: qorex.bech32Address,
              blocks: "17280",
              maxTxs: "50",
              maxValue: "50000000",
              nativeOnly: false,
              allowedTargets: [targetVault, FUSD_ADDRESS, FACTORY_ADDRESS],
            } as unknown as Uint8Array,
          },
        ],
        memo: "LatticeWard open scoped EVM window",
      });
      setWalletInfo(`EVM window opened via QoreX (tx ${res.txHash.slice(0, 14)}...).`);
      void refreshChainState();
    } catch (e) {
      setWalletErr(mapChainError(e));
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
            <button type="button" className="btn btn-primary" onClick={() => void handleConnectQoreX()}>
              {qorex?.connected ? `QoreX: ${qorex.bech32Address.slice(0, 9)}...` : "Connect QoreX"}
            </button>
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
              {walletErr && (
                <div className="alert alert-danger" role="alert">
                  {walletErr}
                </div>
              )}
              {walletInfo && (
                <div className="alert alert-safe" role="status" aria-live="polite">
                  {walletInfo}
                </div>
              )}

              {/* Wallet & Quantum Status Gate */}
              {activeAddress && (
                <section className="card" aria-label="Connected wallet quantum status gate">
                  <div className="row-wrap" style={{ justifyContent: "space-between" }}>
                    <div>
                      <div className="eyebrow">Connected Account · 0x0A02 Quantum Status Gate</div>
                      <div className="mono" style={{ marginTop: 4 }}>
                        EVM: {activeAddress} · Native: {activeQorAddress}
                      </div>
                    </div>
                    {pqcStatus && (
                      <span className={`badge ${pqcStatus.registered ? "badge-safe" : "badge-danger"}`}>
                        {pqcStatus.registered
                          ? `✓ Quantum-Protected (ML-DSA-87 · ${pqcStatus.pubKeyBytes} B)`
                          : "✕ Unprotected (No 0x0A02 Key)"}
                      </span>
                    )}
                  </div>
                </section>
              )}

              <section className="card" aria-label="Active vault selector">
                <div className="row-wrap" style={{ justifyContent: "space-between" }}>
                  <div className="field" style={{ margin: 0, flex: 1, minWidth: 220 }}>
                    <label htmlFor="vault-select">Active Vault</label>
                    <select
                      id="vault-select"
                      value={selectedVaultAddr}
                      onChange={(e) => setSelectedVaultAddr(e.target.value)}
                    >
                      {userVaults.map((v, i) => (
                        <option key={v} value={v}>
                          My Vault #{i + 1} ({v})
                        </option>
                      ))}
                      <option value={REFERENCE_VAULT_ADDRESS}>
                        Live Deployed Vault ({REFERENCE_VAULT_ADDRESS})
                      </option>
                    </select>
                  </div>
                  <button type="button" className="btn" onClick={() => void refreshChainState()}>
                    Sync Chain
                  </button>
                </div>
              </section>

              {(tab === "setup" ||
                tab === "create" ||
                tab === "dashboard" ||
                tab === "allowances" ||
                tab === "emergency") && (
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

              {tab === "setup" && (
                <SetupChecklist
                  qorex={qorex}
                  pqcStatus={pqcStatus}
                  evmWindow={evmWindow}
                  hasVault={userVaults.length > 0}
                  vault={vaultSnapshot}
                  onConnectQoreX={() => void handleConnectQoreX()}
                  onOpenWindowInQoreX={() => void handleOpenWindowInQoreX()}
                  onGoTab={(t) => setTab(t === "deposit" ? "dashboard" : t)}
                />
              )}

              {tab === "create" && (
                <CreateVaultPanel
                  qorex={qorex}
                  unlockedSigner={unlockedSigner}
                  backupConfirmed={backupConfirmed}
                  onVaultCreated={(addr) => {
                    setSelectedVaultAddr(addr);
                    setTab("dashboard");
                    void refreshChainState();
                  }}
                />
              )}

              {tab === "dashboard" && (
                <DashboardPanel
                  vault={vaultSnapshot}
                  qorex={qorex}
                  userFusdBalance={userFusd}
                  onRefresh={() => void refreshChainState()}
                  onGoEmergency={() => setTab("emergency")}
                />
              )}

              {tab === "allowances" && (
                <AllowancesPanel
                  vault={vaultSnapshot}
                  qorex={qorex}
                  unlockedSigner={unlockedSigner}
                  relayerUrl={relayerUrl}
                  onRefresh={() => void refreshChainState()}
                />
              )}

              {tab === "emergency" && (
                <EmergencyPanel
                  vault={vaultSnapshot}
                  qorex={qorex}
                  unlockedSigner={unlockedSigner}
                  evmWindow={evmWindow}
                  relayerUrl={relayerUrl}
                  onRefresh={() => void refreshChainState()}
                />
              )}

              {tab === "agent" && <AgentAccountPanel vault={vaultSnapshot} relayerUrl={relayerUrl} />}
              {tab === "attack" && <AttackLabPanel vault={vaultSnapshot} />}
              {tab === "glossary" && <GlossaryPanel />}
            </div>
          </div>
        )}
      </main>

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
