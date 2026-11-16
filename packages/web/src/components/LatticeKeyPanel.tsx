import { useState } from "react";
import {
  BrowserKeySigner,
  clearBackupFromIndexedDb,
  type EncryptedKeyBackup,
  QoreXSigner,
} from "../lib/signer";

interface Props {
  storedBackup: EncryptedKeyBackup | null;
  unlockedSigner: BrowserKeySigner | null;
  backupConfirmed: boolean;
  onUnlocked: (signer: BrowserKeySigner, backup: EncryptedKeyBackup) => void;
  onBackupConfirmed: () => void;
  onCleared: () => void;
}

export function downloadEncryptedBackup(backup: EncryptedKeyBackup) {
  const shortHash = backup.keyHash.slice(2, 10);
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `latticeward-lattice-key-${shortHash}.lwkey.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function LatticeKeyPanel({
  storedBackup,
  unlockedSigner,
  backupConfirmed,
  onUnlocked,
  onBackupConfirmed,
  onCleared,
}: Props) {
  const [passphrase, setPassphrase] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [verifyCode, setVerifyCode] = useState("");
  const [downloaded, setDownloaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setInfo(null);
    if (passphrase.length < 8) {
      setErr("Choose a passphrase of at least 8 characters.");
      return;
    }
    if (passphrase !== confirmPass) {
      setErr("Passphrases do not match.");
      return;
    }
    setBusy(true);
    try {
      const signer = await BrowserKeySigner.createAndStore(passphrase);
      downloadEncryptedBackup(signer.backup);
      setDownloaded(true);
      setPassphrase("");
      setConfirmPass("");
      onUnlocked(signer, signer.backup);
      setInfo("Lattice key generated, encrypted in this browser, and downloaded as a backup file.");
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setBusy(false);
    }
  };

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!storedBackup) return;
    setErr(null);
    setInfo(null);
    setBusy(true);
    try {
      const signer = await BrowserKeySigner.unlock(storedBackup, passphrase);
      setPassphrase("");
      onUnlocked(signer, storedBackup);
      setInfo("Lattice key unlocked for this session.");
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setBusy(false);
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr(null);
    setInfo(null);
    try {
      const parsed = JSON.parse(await file.text()) as EncryptedKeyBackup;
      if (parsed.version !== 1 || parsed.algorithm !== "ML-DSA-87" || !parsed.keyHash) {
        throw new Error("That file is not a valid LatticeWard encrypted key backup.");
      }
      if (!passphrase) {
        throw new Error("Enter the backup's passphrase above before importing the file.");
      }
      const signer = await BrowserKeySigner.unlock(parsed, passphrase);
      const { saveBackupToIndexedDb } = await import("../lib/signer");
      await saveBackupToIndexedDb(parsed);
      setPassphrase("");
      onUnlocked(signer, parsed);
      onBackupConfirmed();
      setInfo("Encrypted backup imported and unlocked.");
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    }
  };

  const handleConfirmBackup = () => {
    setErr(null);
    const activeHash = storedBackup?.keyHash ?? "";
    const expected = activeHash.slice(2, 10).toLowerCase();
    if (!downloaded && !backupConfirmed) {
      setErr("Download your encrypted backup file first so you do not lose access to your vault.");
      return;
    }
    if (verifyCode.trim().toLowerCase() !== expected) {
      setErr(`Enter the 8-character key fingerprint (${expected}) to confirm you saved your backup.`);
      return;
    }
    onBackupConfirmed();
    setInfo("Backup confirmed. You can now create and administer vaults with this Lattice key.");
  };

  const handleTestQoreXStub = async () => {
    setErr(null);
    try {
      const qx = new QoreXSigner();
      await qx.sign(new Uint8Array(32));
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    }
  };

  return (
    <section className="card" aria-labelledby="lattice-key-heading">
      <h2 id="lattice-key-heading">Your Sovereign Lattice Key (ML-DSA-87)</h2>
      <p className="muted">
        <strong>Honest key-custody notice:</strong> This key is generated randomly in your browser, encrypted with your
        passphrase (PBKDF2 + AES-GCM), and stored locally in IndexedDB. We never see it and cannot recover it. If you
        clear browser data without your encrypted backup file and passphrase, you lose admin control over vaults tied to
        this key.
      </p>

      {err && (
        <div className="alert alert-danger" role="alert">
          {err}
        </div>
      )}
      {info && (
        <div className="alert alert-safe" role="status" aria-live="polite">
          {info}
        </div>
      )}

      {unlockedSigner ? (
        <div>
          <div className="alert alert-safe">
            <strong>Unlocked:</strong> Key fingerprint{" "}
            <span className="mono">{unlockedSigner.backup.keyHash.slice(0, 14)}...</span>
          </div>
          <div className="row-wrap">
            <button
              type="button"
              className="btn"
              onClick={() => {
                downloadEncryptedBackup(unlockedSigner.backup);
                setDownloaded(true);
              }}
            >
              Download Encrypted Backup (.lwkey.json)
            </button>
            <button
              type="button"
              className="btn"
              onClick={async () => {
                await clearBackupFromIndexedDb();
                onCleared();
              }}
            >
              Remove Key from Browser
            </button>
          </div>

          {!backupConfirmed && (
            <div className="diff-box" style={{ marginTop: 12 }}>
              <h3>Confirm your backup before creating your first vault</h3>
              <p className="muted">
                Keep the downloaded <span className="mono">.lwkey.json</span> file in a safe place. Type the 8-character
                fingerprint <strong className="mono">{unlockedSigner.backup.keyHash.slice(2, 10)}</strong> below to
                confirm:
              </p>
              <div className="row-wrap">
                <label htmlFor="backup-verify-input" className="skip-link">
                  Key fingerprint confirmation
                </label>
                <input
                  id="backup-verify-input"
                  type="text"
                  value={verifyCode}
                  onChange={(e) => setVerifyCode(e.target.value)}
                  placeholder={unlockedSigner.backup.keyHash.slice(2, 10)}
                  style={{ maxWidth: 200, minHeight: 44, padding: "8px 10px" }}
                />
                <button type="button" className="btn btn-primary" onClick={handleConfirmBackup}>
                  Confirm Backup
                </button>
              </div>
            </div>
          )}
        </div>
      ) : storedBackup ? (
        <form onSubmit={handleUnlock}>
          <p className="muted">
            An encrypted Lattice key (<span className="mono">{storedBackup.keyHash.slice(0, 14)}...</span>) is saved in
            this browser. Enter your passphrase to unlock it for this session.
          </p>
          <div className="field">
            <label htmlFor="unlock-pass">Passphrase</label>
            <input
              id="unlock-pass"
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          <div className="row-wrap">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Unlocking..." : "Unlock Lattice Key"}
            </button>
            <button
              type="button"
              className="btn"
              onClick={async () => {
                await clearBackupFromIndexedDb();
                onCleared();
              }}
            >
              Clear Stored Key
            </button>
          </div>
        </form>
      ) : (
        <form onSubmit={handleCreate}>
          <div className="grid-2">
            <div className="field">
              <label htmlFor="new-pass">Choose a passphrase (min 8 chars)</label>
              <input
                id="new-pass"
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="confirm-pass">Confirm passphrase</label>
              <input
                id="confirm-pass"
                type="password"
                value={confirmPass}
                onChange={(e) => setConfirmPass(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>
          </div>
          <div className="row-wrap">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Generating ML-DSA-87 Key..." : "Generate Lattice Key & Download Backup"}
            </button>
            <label className="btn" htmlFor="import-lwkey" style={{ cursor: "pointer" }}>
              Import .lwkey.json Backup
              <input
                id="import-lwkey"
                type="file"
                accept=".json,.lwkey.json"
                onChange={handleImportFile}
                style={{ display: "none" }}
              />
            </label>
          </div>
        </form>
      )}

      <div style={{ marginTop: 14, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
        <span className="muted">
          QoreX hardware/extension arbitrary ML-DSA signing (<code>signArbitrary</code>) is planned by QoreX and not
          shipped yet.{" "}
        </span>
        <button type="button" className="btn" style={{ minHeight: 36, padding: "4px 10px" }} onClick={handleTestQoreXStub}>
          Check QoreX Signer Status
        </button>
      </div>
    </section>
  );
}
