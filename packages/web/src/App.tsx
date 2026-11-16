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
import {
  type MetaMaskConnection,
  type QoreXConnection,
  connectMetaMask,
  connectQoreX,
  mapChainError,
} from "./lib/wallets";
import { LatticeKeyPanel } from "./components/LatticeKeyPanel";
import { SetupChecklist } from "./components/SetupChecklist";
import { CreateVaultPanel } from "./components/CreateVaultPanel";
import { DashboardPanel } from "./components/DashboardPanel";
import { AllowancesPanel } from "./components/AllowancesPanel";
import { AgentAccountPanel, AttackLabPanel, GlossaryPanel } from "./components/AgentAndAttackPanels";

type TabId = "setup" | "dashboard" | "create" | "allowances" | "agent" | "attack" | "glossary";

export function App() {
  const [tab, setTab] = useState<TabId>("setup");
  const [qorex, setQorex] = useState<QoreXConnection | null>(null);
  const [metamask, setMetamask] = useState<MetaMaskConnection | null>(null);
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

  const activeAddress = metamask?.address || qorex?.evmAddress || "";

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
      setWalletInfo(`QoreX connected: ${conn.bech32Address}`);
    } catch (e) {
      setWalletErr(mapChainError(e));
    }
  };

  const handleConnectMetaMask = async () => {
    setWalletErr(null);
    setWalletInfo(null);
    try {
      const conn = await connectMetaMask();
      setMetamask(conn);
      setWalletInfo(`MetaMask connected on QoreChain Diana (9800): ${conn.address}`);
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
              allowedTargets: [],
            } as unknown as Uint8Array,
          },
        ],
        memo: "LatticeWard open EVM window",
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
        Testnet prototype — QoreChain Diana (EVM Chain ID 9800). Funds in your vault are protected by post-quantum rules;
        use testnet tokens only.
      </div>

      <div className="app-shell">
        <header className="header">
          <div className="brand">
            <h1>LatticeWard</h1>
            <p>
              Post-quantum spend-governance vaults so a leaked classical key or Q-Day cannot drain your AI agent&apos;s
              treasury.
            </p>
          </div>

          <div className="wallet-bar">
            <button type="button" className="btn" onClick={() => void handleConnectQoreX()}>
              {qorex?.connected ? `QoreX: ${qorex.bech32Address.slice(0, 10)}...` : "Connect QoreX"}
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void handleConnectMetaMask()}>
              {metamask?.connected ? `MetaMask: ${metamask.address.slice(0, 8)}...` : "Connect MetaMask"}
            </button>
          </div>
        </header>

        {walletErr && (
          <div className="alert alert-danger" role="alert">
            {walletErr}
          </div>
        )}
        {walletInfo && (
          <div className="alert alert-success" role="status" aria-live="polite">
            {walletInfo}
          </div>
        )}

        <section className="card" aria-label="Active vault selector">
          <div className="row-wrap" style={{ justifyContent: "space-between" }}>
            <div className="field" style={{ margin: 0, flex: 1, minWidth: 240 }}>
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
                  Reference Drilled Vault (Read-Only: {REFERENCE_VAULT_ADDRESS.slice(0, 10)}...)
                </option>
              </select>
            </div>
            <button type="button" className="btn" onClick={() => void refreshChainState()}>
              Sync Chain
            </button>
          </div>
        </section>

        <nav className="nav-tabs" role="tablist" aria-label="LatticeWard sections">
          {(
            [
              ["setup", "Setup"],
              ["dashboard", "Dashboard & Emergency"],
              ["create", "Create Vault"],
              ["allowances", "Allowances"],
              ["agent", "Agent & MCP"],
              ["attack", "Attack Lab"],
              ["glossary", "Glossary"],
            ] as [TabId, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className="nav-tab"
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>

        <main id="main-content">
          {(tab === "setup" || tab === "create" || tab === "dashboard" || tab === "allowances") && (
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
              metamask={metamask}
              pqcStatus={pqcStatus}
              evmWindow={evmWindow}
              hasVault={userVaults.length > 0}
              vault={vaultSnapshot}
              onConnectQoreX={() => void handleConnectQoreX()}
              onConnectMetaMask={() => void handleConnectMetaMask()}
              onOpenWindowInQoreX={() => void handleOpenWindowInQoreX()}
              onGoTab={(t) => setTab(t === "deposit" ? "dashboard" : t)}
            />
          )}

          {tab === "create" && (
            <CreateVaultPanel
              metamask={metamask}
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
              metamask={metamask}
              unlockedSigner={unlockedSigner}
              userFusdBalance={userFusd}
              evmWindow={evmWindow}
              relayerUrl={relayerUrl}
              onRefresh={() => void refreshChainState()}
            />
          )}

          {tab === "allowances" && (
            <AllowancesPanel
              vault={vaultSnapshot}
              metamask={metamask}
              unlockedSigner={unlockedSigner}
              relayerUrl={relayerUrl}
              onRefresh={() => void refreshChainState()}
            />
          )}

          {tab === "agent" && <AgentAccountPanel vault={vaultSnapshot} relayerUrl={relayerUrl} />}
          {tab === "attack" && <AttackLabPanel vault={vaultSnapshot} />}
          {tab === "glossary" && <GlossaryPanel />}
        </main>
      </div>
    </>
  );
}
