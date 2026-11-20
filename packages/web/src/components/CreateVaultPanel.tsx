import { useState } from "react";
import { Contract, Wallet, isAddress, parseEther, parseUnits } from "ethers";
import { FACTORY_ABI, FACTORY_ADDRESS, FUSD_ADDRESS, ZERO_ADDRESS, explorerTxUrl } from "../lib/constants";
import type { BrowserKeySigner } from "../lib/signer";
import { mapChainError, type QoreXConnection } from "../lib/wallets";

interface Props {
  qorex: QoreXConnection | null;
  unlockedSigner: BrowserKeySigner | null;
  backupConfirmed: boolean;
  onVaultCreated: (vaultAddress: string) => void;
}

export function CreateVaultPanel({ qorex, unlockedSigner, backupConfirmed, onVaultCreated }: Props) {
  const [agentAddr, setAgentAddr] = useState(qorex?.evmAddress || "");
  const [qorMaxTx, setQorMaxTx] = useState("1");
  const [qorDaily, setQorDaily] = useState("3");
  const [fusdMaxTx, setFusdMaxTx] = useState("10");
  const [fusdDaily, setFusdDaily] = useState("30");
  const [windowDays, setWindowDays] = useState("14");
  const [requirePqc, setRequirePqc] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const handleGenerateAgent = () => {
    const w = Wallet.createRandom();
    setAgentAddr(w.address);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setTxHash(null);

    if (!qorex?.connected || !qorex.evmProvider) {
      setErr("Connect QoreX (with EVM access) first to deploy your vault.");
      return;
    }
    if (!unlockedSigner) {
      setErr("Create or unlock your Lattice key first.");
      return;
    }
    if (!backupConfirmed) {
      setErr("Download and confirm your encrypted Lattice key backup before creating your first vault.");
      return;
    }
    if (!isAddress(agentAddr)) {
      setErr("Enter a valid 0x agent address.");
      return;
    }

    setBusy(true);
    try {
      const signer = await qorex.evmProvider.getSigner();
      const factory = new Contract(FACTORY_ADDRESS, FACTORY_ABI, signer);
      const keyHash = await unlockedSigner.keyHash();
      const now = Math.floor(Date.now() / 1000);
      const days = Math.max(1, Math.min(365, Number(windowDays) || 14));

      const policy = {
        agent: agentAddr,
        windowExpiresAt: BigInt(now + days * 86400),
        epochDuration: BigInt(86400),
        maxRiskScoreBps: BigInt(3000),
        requireRecipientPqc: requirePqc,
        frozen: false,
      };

      const initialAssets = [
        {
          asset: ZERO_ADDRESS,
          enabled: true,
          maxTxValue: parseEther(qorMaxTx || "1"),
          epochLimit: parseEther(qorDaily || "3"),
        },
        {
          asset: FUSD_ADDRESS,
          enabled: true,
          maxTxValue: parseUnits(fusdMaxTx || "10", 6),
          epochLimit: parseUnits(fusdDaily || "30", 6),
        },
      ];

      const tx = await factory.createVault(keyHash, policy, initialAssets);
      setTxHash(tx.hash);
      const receipt = await tx.wait();
      let createdVault = "";
      for (const log of receipt.logs ?? []) {
        try {
          const parsed = factory.interface.parseLog(log);
          if (parsed?.name === "VaultCreated") {
            createdVault = parsed.args[1] as string;
            break;
          }
        } catch {
          // ignore
        }
      }
      if (!createdVault) {
        const list = (await factory.vaultsOf(qorex.evmAddress)) as string[];
        createdVault = list[list.length - 1] ?? "";
      }
      if (createdVault) {
        onVaultCreated(createdVault);
      }
    } catch (e2) {
      setErr(mapChainError(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card" aria-labelledby="create-vault-heading">
      <h2 id="create-vault-heading">Create Your Isolated Vault</h2>
      <p className="muted">
        Deploys a new <code>LatticeWardVault</code> via <code>VaultFactory</code>. Only your Lattice key can change
        rules, freeze, or withdraw. Funds in your vault are protected even if the agent key leaks.
      </p>

      {!backupConfirmed && (
        <div className="alert alert-caution">
          <strong>Backup required first:</strong> Unlock your Lattice key above, download the{" "}
          <span className="mono">.lwkey.json</span> backup, and enter its 8-character fingerprint to enable vault
          creation.
        </div>
      )}

      {err && (
        <div className="alert alert-danger" role="alert">
          {err}
        </div>
      )}
      {txHash && (
        <div className="alert alert-safe" role="status" aria-live="polite">
          Vault deployment transaction sent:{" "}
          <a href={explorerTxUrl(txHash)} target="_blank" rel="noreferrer">
            View on QoreScan Explorer
          </a>
        </div>
      )}

      <form onSubmit={handleCreate}>
        <div className="field">
          <label htmlFor="cv-agent">Scoped Agent Address (0x...)</label>
          <div className="row-wrap">
            <input
              id="cv-agent"
              type="text"
              value={agentAddr}
              onChange={(e) => setAgentAddr(e.target.value)}
              placeholder="0x..."
              required
              style={{ flex: 1, minWidth: 220 }}
            />
            <button type="button" className="btn" onClick={handleGenerateAgent}>
              Use Fresh Address
            </button>
          </div>
          <span className="muted">
            Tip: For testing, you can use your own address or generate a separate agent address.
          </span>
        </div>

        <div className="grid-2">
          <div className="field">
            <label htmlFor="cv-qor-tx">QOR max per payment</label>
            <input id="cv-qor-tx" type="number" step="0.01" min="0" value={qorMaxTx} onChange={(e) => setQorMaxTx(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="cv-qor-day">QOR daily limit</label>
            <input id="cv-qor-day" type="number" step="0.01" min="0" value={qorDaily} onChange={(e) => setQorDaily(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="cv-fusd-tx">fUSD max per payment</label>
            <input id="cv-fusd-tx" type="number" step="0.1" min="0" value={fusdMaxTx} onChange={(e) => setFusdMaxTx(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="cv-fusd-day">fUSD daily limit</label>
            <input id="cv-fusd-day" type="number" step="0.1" min="0" value={fusdDaily} onChange={(e) => setFusdDaily(e.target.value)} />
          </div>
        </div>

        <div className="grid-2">
          <div className="field">
            <label htmlFor="cv-days">Vault schedule window (days)</label>
            <input id="cv-days" type="number" min="1" max="365" value={windowDays} onChange={(e) => setWindowDays(e.target.value)} />
          </div>
          <div className="field" style={{ display: "flex", alignItems: "center", gap: 10, paddingTop: 26 }}>
            <input
              id="cv-pqc"
              type="checkbox"
              checked={requirePqc}
              onChange={(e) => setRequirePqc(e.target.checked)}
              style={{ width: 22, height: 22, minHeight: 22 }}
            />
            <label htmlFor="cv-pqc" style={{ margin: 0 }}>
              Quantum-safety recipient firewall (0x0A02)
            </label>
          </div>
        </div>

        <button
          type="submit"
          className="btn btn-primary"
          disabled={busy || !qorex?.evmProvider || !unlockedSigner || !backupConfirmed}
        >
          {busy ? "Deploying Vault..." : "Deploy Isolated Vault"}
        </button>
      </form>
    </section>
  );
}
