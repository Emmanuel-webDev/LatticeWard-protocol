import { ml_dsa87 } from "@noble/post-quantum/ml-dsa";
import { getBytes, keccak256 } from "ethers";

export interface SovereignSigner {
  readonly label: string;
  publicKey(): Promise<Uint8Array>;
  keyHash(): Promise<string>;
  sign(digest: Uint8Array): Promise<Uint8Array>;
}

export interface EncryptedKeyBackup {
  version: 1;
  algorithm: "ML-DSA-87";
  kdf: "PBKDF2-SHA256";
  iterations: number;
  cipher: "AES-256-GCM";
  keyHash: string;
  publicKeyHex: string;
  saltHex: string;
  ivHex: string;
  ciphertextHex: string;
  createdAt: string;
}

const DB_NAME = "latticeward-sovereign-keys";
const STORE_NAME = "keys";
const ACTIVE_RECORD_ID = "active";
const PBKDF2_ITERATIONS = 310_000;

function toHex(bytes: Uint8Array): string {
  return (
    "0x" +
    Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  );
}

function fromHex(hex: string): Uint8Array {
  return getBytes(hex.startsWith("0x") ? hex : `0x${hex}`);
}

async function deriveAesKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function openKeyDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Could not open browser key storage (IndexedDB)."));
  });
}

export async function saveBackupToIndexedDb(backup: EncryptedKeyBackup): Promise<void> {
  const db = await openKeyDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put({ id: ACTIVE_RECORD_ID, backup });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to save Lattice key to browser storage."));
  });
}

export async function loadBackupFromIndexedDb(): Promise<EncryptedKeyBackup | null> {
  const db = await openKeyDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(ACTIVE_RECORD_ID);
    req.onsuccess = () => {
      const rec = req.result as { id: string; backup: EncryptedKeyBackup } | undefined;
      resolve(rec?.backup ?? null);
    };
    req.onerror = () => reject(req.error ?? new Error("Failed to read Lattice key from browser storage."));
  });
}

export async function clearBackupFromIndexedDb(): Promise<void> {
  const db = await openKeyDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(ACTIVE_RECORD_ID);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to clear browser key storage."));
  });
}

export class BrowserKeySigner implements SovereignSigner {
  readonly label = "Browser Lattice Key (ML-DSA-87)";
  private readonly pk: Uint8Array;
  private readonly sk: Uint8Array;
  private readonly hash: string;
  readonly backup: EncryptedKeyBackup;

  private constructor(pk: Uint8Array, sk: Uint8Array, backup: EncryptedKeyBackup) {
    this.pk = pk;
    this.sk = sk;
    this.hash = keccak256(pk);
    this.backup = backup;
  }

  static async createAndStore(passphrase: string): Promise<BrowserKeySigner> {
    if (passphrase.trim().length < 8) {
      throw new Error("Passphrase must be at least 8 characters to protect your Lattice key.");
    }
    const seed = crypto.getRandomValues(new Uint8Array(32));
    const { publicKey, secretKey } = ml_dsa87.keygen(seed);
    seed.fill(0);

    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const aesKey = await deriveAesKey(passphrase, salt);
    const ciphertextBuf = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      aesKey,
      secretKey as BufferSource,
    );

    const backup: EncryptedKeyBackup = {
      version: 1,
      algorithm: "ML-DSA-87",
      kdf: "PBKDF2-SHA256",
      iterations: PBKDF2_ITERATIONS,
      cipher: "AES-256-GCM",
      keyHash: keccak256(publicKey),
      publicKeyHex: toHex(publicKey),
      saltHex: toHex(salt),
      ivHex: toHex(iv),
      ciphertextHex: toHex(new Uint8Array(ciphertextBuf)),
      createdAt: new Date().toISOString(),
    };

    await saveBackupToIndexedDb(backup);
    return new BrowserKeySigner(publicKey, secretKey, backup);
  }

  static async unlock(backup: EncryptedKeyBackup, passphrase: string): Promise<BrowserKeySigner> {
    if (backup.version !== 1 || backup.algorithm !== "ML-DSA-87") {
      throw new Error("Unsupported Lattice key backup format.");
    }
    const salt = fromHex(backup.saltHex);
    const iv = fromHex(backup.ivHex);
    const ciphertext = fromHex(backup.ciphertextHex);
    const aesKey = await deriveAesKey(passphrase, salt);

    let plainBuf: ArrayBuffer;
    try {
      plainBuf = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: iv as BufferSource },
        aesKey,
        ciphertext as BufferSource,
      );
    } catch {
      throw new Error("Incorrect passphrase or damaged Lattice key backup.");
    }

    const pk = fromHex(backup.publicKeyHex);
    const sk = new Uint8Array(plainBuf);
    if (pk.length !== 2592 || sk.length !== 4896) {
      throw new Error("Decrypted Lattice key has unexpected byte length.");
    }
    if (keccak256(pk).toLowerCase() !== backup.keyHash.toLowerCase()) {
      throw new Error("Lattice key checksum mismatch.");
    }
    return new BrowserKeySigner(pk, sk, backup);
  }

  async publicKey(): Promise<Uint8Array> {
    return this.pk;
  }

  async keyHash(): Promise<string> {
    return this.hash;
  }

  async sign(digest: Uint8Array): Promise<Uint8Array> {
    if (digest.length !== 32) {
      throw new Error(`Expected 32-byte digest from sovereignDigest(), got ${digest.length} bytes.`);
    }
    const sig = ml_dsa87.sign(this.sk, digest);
    if (sig.length !== 4627) {
      throw new Error(`Unexpected ML-DSA-87 signature length: ${sig.length}`);
    }
    return sig;
  }
}

export class QoreXSigner implements SovereignSigner {
  readonly label = "QoreX Native Arbitrary Signer (Planned)";

  async publicKey(): Promise<Uint8Array> {
    throw new Error("not available yet: QoreX arbitrary ML-DSA message signing (signArbitrary) has not shipped.");
  }

  async keyHash(): Promise<string> {
    throw new Error("not available yet: QoreX arbitrary ML-DSA message signing (signArbitrary) has not shipped.");
  }

  async sign(_digest: Uint8Array): Promise<Uint8Array> {
    throw new Error("not available yet: QoreX arbitrary ML-DSA message signing (signArbitrary) has not shipped.");
  }
}
