import {
  discoverQorexEip1193,
  getQorexNative,
  hasCapability,
  type QorexNativeProvider,
} from "@qorechain/qorex-types";
import { bech32 } from "bech32";
import { BrowserProvider, getAddress, getBytes } from "ethers";
import { CHAIN_ID, CHAIN_ID_HEX, CHAIN_NAME, COSMOS_CHAIN_ID, EVM_RPC_URL, EXPLORER_URL } from "./constants";

export interface QoreXConnection {
  connected: boolean;
  walletKind: "qorex" | "metamask";
  bech32Address: string;
  evmAddress: string;
  chainId: string;
  canSignAndBroadcast: boolean;
  native: QorexNativeProvider | null;
  evmProvider: BrowserProvider | null;
}

export function evmToQor(evmAddress: string): string {
  const bytes = getBytes(getAddress(evmAddress));
  return bech32.encode("qor", bech32.toWords(bytes));
}

export function qorToEvm(qorAddress: string): string {
  const decoded = bech32.decode(qorAddress);
  const data = new Uint8Array(bech32.fromWords(decoded.words));
  const hex =
    "0x" +
    Array.from(data)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  return getAddress(hex);
}

interface Eip1193Like {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = window.setTimeout(() => reject(new Error(`${label} timed out. Check if a QoreX popup is waiting for approval.`)), ms);
    promise.then(
      (val) => {
        window.clearTimeout(id);
        resolve(val);
      },
      (err) => {
        window.clearTimeout(id);
        reject(err);
      },
    );
  });
}

async function ensureQoreChainEvmNetwork(eth: Eip1193Like): Promise<void> {
  const currentHex = (await withTimeout(eth.request({ method: "eth_chainId" }), 4000, "Network check")) as string;
  if (parseInt(currentHex, 16) === CHAIN_ID) return;

  try {
    await withTimeout(
      eth.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: CHAIN_ID_HEX }],
      }),
      15000,
      "Network switch",
    );
  } catch (err: unknown) {
    const e = err as { code?: number; message?: string; data?: { originalError?: { code?: number } } };
    const code = e?.code ?? e?.data?.originalError?.code;
    const msg = String(e?.message ?? "").toLowerCase();
    // If user explicitly clicked Cancel (4001), surface the error instead of re-prompting
    if (code === 4001 || msg.includes("user rejected")) {
      throw err;
    }
    // Chain not added yet (4902, nested 4902, or unrecognized chain) -> add QoreChain Diana automatically
    await withTimeout(
      eth.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: CHAIN_ID_HEX,
            chainName: CHAIN_NAME,
            nativeCurrency: { name: "Qore", symbol: "QOR", decimals: 18 },
            rpcUrls: [EVM_RPC_URL],
            blockExplorerUrls: [EXPLORER_URL],
          },
        ],
      }),
      20000,
      "Add QoreChain Diana Testnet",
    );
    // Ensure MetaMask switches to it after adding
    try {
      await withTimeout(
        eth.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: CHAIN_ID_HEX }],
        }),
        10000,
        "Switch to QoreChain Diana Testnet",
      );
    } catch {
      // Some wallets auto-switch on wallet_addEthereumChain
    }
  }
}

export async function connectQoreX(): Promise<QoreXConnection> {
  const native = getQorexNative();
  const evm = await discoverQorexEip1193({ timeoutMs: 800 });

  if (!native && !evm) {
    throw new Error(
      "QoreX wallet was not detected in this browser. Install the QoreX extension (Chrome/Firefox/Safari) or open this page inside the QoreX mobile dApp browser.",
    );
  }

  let evmProvider: BrowserProvider | null = null;
  let evmFromEip1193 = "";

  if (evm) {
    try {
      // Check already-authorized accounts first so we don't stack redundant popups
      let accounts = (await withTimeout(
        evm.request({ method: "eth_accounts" }),
        4000,
        "QoreX account check",
      )) as string[];
      if (!accounts?.length) {
        accounts = (await withTimeout(
          evm.request({ method: "eth_requestAccounts" }),
          25000,
          "QoreX connection",
        )) as string[];
      }
      if (accounts?.length) {
        evmFromEip1193 = getAddress(accounts[0]);
      }
      await ensureQoreChainEvmNetwork(evm as unknown as Eip1193Like);
      evmProvider = new BrowserProvider(evm as never);
    } catch {
      // If QoreX EVM lane permission was declined or unavailable, keep native connection working
    }
  }

  if (native) {
    let key: { bech32Address: string } | null = null;
    try {
      key = await withTimeout(native.getKey(COSMOS_CHAIN_ID), 4000, "QoreX native key");
    } catch {
      try {
        await withTimeout(native.enable(COSMOS_CHAIN_ID), 25000, "QoreX native enable");
      } catch {
        // Suggest qorechain-diana automatically if QoreX does not have it enabled yet
        if (typeof (native as { experimentalSuggestChain?: (c: { chainId: string }) => Promise<void> }).experimentalSuggestChain === "function") {
          await withTimeout(
            (native as { experimentalSuggestChain: (c: { chainId: string }) => Promise<void> }).experimentalSuggestChain({
              chainId: COSMOS_CHAIN_ID,
            }),
            15000,
            "Suggest QoreChain Diana",
          );
          await withTimeout(native.enable(COSMOS_CHAIN_ID), 25000, "QoreX native enable");
        } else {
          throw new Error("Could not enable QoreChain Diana (qorechain-diana) in QoreX.");
        }
      }
      key = await withTimeout(native.getKey(COSMOS_CHAIN_ID), 6000, "QoreX native key");
    }
    const evmAddr = evmFromEip1193 || qorToEvm(key.bech32Address);
    return {
      connected: true,
      walletKind: "qorex",
      bech32Address: key.bech32Address,
      evmAddress: evmAddr,
      chainId: COSMOS_CHAIN_ID,
      canSignAndBroadcast: hasCapability(native, "signAndBroadcast"),
      native,
      evmProvider,
    };
  }

  if (!evmFromEip1193) {
    throw new Error("QoreX did not return an account. Check if QoreX is unlocked and try again.");
  }
  return {
    connected: true,
    walletKind: "qorex",
    bech32Address: evmToQor(evmFromEip1193),
    evmAddress: evmFromEip1193,
    chainId: COSMOS_CHAIN_ID,
    canSignAndBroadcast: false,
    native: null,
    evmProvider,
  };
}

interface Eip6963Detail {
  info?: { rdns?: string; name?: string };
  provider?: Eip1193Like & { isMetaMask?: boolean; isQorex?: boolean };
}

function discoverMetaMaskProvider(timeoutMs = 500): Promise<(Eip1193Like & { isMetaMask?: boolean }) | null> {
  return new Promise((resolve) => {
    let found: (Eip1193Like & { isMetaMask?: boolean }) | null = null;
    const onAnnounce = (event: Event) => {
      const detail = (event as CustomEvent<Eip6963Detail>).detail;
      const rdns = detail?.info?.rdns?.toLowerCase() || "";
      const name = detail?.info?.name?.toLowerCase() || "";
      if (detail?.provider && (rdns.includes("metamask") || name.includes("metamask")) && !rdns.includes("qorex")) {
        found = detail.provider;
      }
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));

    window.setTimeout(() => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      if (found) {
        resolve(found);
        return;
      }
      const w = window as unknown as {
        ethereum?: Eip1193Like & {
          isMetaMask?: boolean;
          isQorex?: boolean;
          providers?: Array<Eip1193Like & { isMetaMask?: boolean; isQorex?: boolean }>;
        };
      };
      if (Array.isArray(w.ethereum?.providers)) {
        const mm = w.ethereum.providers.find((p) => p.isMetaMask && !p.isQorex);
        if (mm) {
          resolve(mm);
          return;
        }
      }
      if (w.ethereum && !w.ethereum.isQorex) {
        resolve(w.ethereum);
        return;
      }
      resolve(null);
    }, timeoutMs);
  });
}

export async function connectMetaMask(): Promise<QoreXConnection> {
  const mm = await discoverMetaMaskProvider(500);
  if (!mm) {
    throw new Error("MetaMask was not detected in this browser. Install or unlock MetaMask and try again.");
  }

  let accounts = (await withTimeout(mm.request({ method: "eth_accounts" }), 4000, "MetaMask check")) as string[];
  if (!accounts?.length) {
    accounts = (await withTimeout(
      mm.request({ method: "eth_requestAccounts" }),
      25000,
      "MetaMask connection",
    )) as string[];
  }
  if (!accounts?.length) {
    throw new Error("MetaMask did not return an account.");
  }

  // Automatically switch to (or add) QoreChain Diana Testnet (Chain ID 9800)
  await ensureQoreChainEvmNetwork(mm);

  const evmAddress = getAddress(accounts[0]);
  return {
    connected: true,
    walletKind: "metamask",
    bech32Address: evmToQor(evmAddress),
    evmAddress,
    chainId: COSMOS_CHAIN_ID,
    canSignAndBroadcast: false,
    native: null,
    evmProvider: new BrowserProvider(mm as never),
  };
}

export function mapChainError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();

  if (lower.includes("user rejected") || lower.includes("action_rejected") || lower.includes("4001")) {
    return "You cancelled the signature request in your wallet. Nothing was sent.";
  }
  if (lower.includes("coin 118") || lower.includes("coin 60") || lower.includes("4100")) {
    return "Switch to an Ethereum (coin 60) account in QoreX: open Your accounts → Add an Ethereum account (coin 60), switch to it, fund it with QOR, and retry.";
  }
  if (lower.includes("notagent") || lower.includes("0x9d9c0d26")) {
    return "Blocked (NotAgent): Only this vault's authorized agentKey can broadcast agent payments. Use 'Test Against Policy' to simulate from the vault's agentKey.";
  }
  if (
    lower.includes("code 26") ||
    lower.includes("pqc key") ||
    lower.includes("no registered") ||
    lower.includes("26:")
  ) {
    return "Refusal code 26: Your account needs a registered ML-DSA-87 key and an open EVM window. Open QoreX, confirm your post-quantum key is registered, and open an EVM window before retrying.";
  }
  if (
    lower.includes("code 27") ||
    lower.includes("exhausted") ||
    lower.includes("does not admit this transaction") ||
    lower.includes("out of scope")
  ) {
    return "Refusal code 27: Your EVM window is closed, out of transactions/blocks, or its max value is lower than this transaction's value + max fee. Open a fresh EVM window in QoreX and retry.";
  }
  if (lower.includes("code 28") || lower.includes("invalid bounds")) {
    return "Refusal code 28: The requested EVM window bounds are invalid (blocks must be 1–17,280, txs 1–1,000, and max value > 0 uqor).";
  }
  if (lower.includes("recipientnotquantumsafe")) {
    return "Blocked by the quantum-safety firewall (0x0A02): this recipient does not have a registered ML-DSA-87 key.";
  }
  if (lower.includes("invalidmldsasignature") || lower.includes("sovereignkeymismatch")) {
    return "The Lattice key signature did not verify on-chain (0x0A01). Make sure you unlocked the exact Lattice key that owns this vault.";
  }
  if (lower.includes("vaultfrozen")) {
    return "This vault is currently frozen. Unfreeze it with your Lattice key before sending payments.";
  }
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return "QoreChain did not confirm the transaction in time. Check QoreScan in a minute; it may still go through.";
  }
  if (lower.includes("call_exception") || lower.includes("execution reverted") || lower.includes("missing revert data")) {
    return "The vault would reject this transaction, so nothing was sent and no fee was spent.";
  }
  const nestedMsg = raw.match(/"message"\s*:\s*"([^"]+)"/);
  if (nestedMsg?.[1]) {
    return nestedMsg[1].slice(0, 180);
  }
  const shortLine = raw.split("(")[0]?.trim() || raw;
  return shortLine.length > 180 ? `${shortLine.slice(0, 177)}...` : shortLine;
}
