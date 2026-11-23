import { AbiCoder, Contract, Interface, JsonRpcProvider, formatEther, formatUnits, getAddress, keccak256, toUtf8Bytes } from "ethers";
import {
  CHAIN_ID,
  CHAIN_NAME,
  DEFAULT_RELAYER_URL,
  ERC20_ABI,
  EVM_RPC_URL,
  FACTORY_ABI,
  FACTORY_ADDRESS,
  FUSD_ADDRESS,
  PQC_KEY_STATUS_ADDRESS,
  REST_API_URL,
  VAULT_ABI,
  ZERO_ADDRESS,
} from "./constants";
import { evmToQor } from "./wallets";
import type { SovereignSigner } from "./signer";

let _rpc: JsonRpcProvider | null = null;
export function getReadProvider(): JsonRpcProvider {
  if (!_rpc) {
    _rpc = new JsonRpcProvider(
      EVM_RPC_URL,
      { chainId: CHAIN_ID, name: CHAIN_NAME },
      { staticNetwork: true, batchMaxCount: 1 } as never,
    );
  }
  return _rpc;
}

export interface PqcStatus {
  address: string;
  qorAddress: string;
  registered: boolean;
  algorithm: number;
  pubKeyBytes: number;
}

export interface EvmWindowStatus {
  status: "open" | "closed" | "cors_blocked" | "error";
  remainingBlocks: string;
  remainingTxs: string;
  remainingValueUqor: string;
  message: string;
}

export interface AssetLimitView {
  enabled: boolean;
  maxTxValue: bigint;
  epochLimit: bigint;
  epochSpent: bigint;
  epochStart: bigint;
}

export interface VaultSnapshot {
  address: string;
  qorAddress: string;
  sovereignKeyHash: string;
  agentKey: string;
  windowExpiresAt: number;
  epochDuration: number;
  maxRiskScoreBps: number;
  requireRecipientPqc: boolean;
  frozen: boolean;
  policyNonce: bigint;
  qorBalance: bigint;
  fusdBalance: bigint;
  fusdDecimals: number;
  qorLimit: AssetLimitView;
  fusdLimit: AssetLimitView;
  events: TimelineEvent[];
}

export interface TimelineEvent {
  id: string;
  blockNumber: number;
  txHash: string;
  title: string;
  detail: string;
  kind?: "agent_payment" | "other";
  intentId?: string;
}

export async function checkPqcKeyStatus(address: string): Promise<PqcStatus> {
  const clean = getAddress(address);
  const iface = new Interface(["function pqcKeyStatus(address) view returns (bool,uint8,bytes)"]);
  const calldata = iface.encodeFunctionData("pqcKeyStatus", [clean]);
  const raw = await getReadProvider().call({ to: PQC_KEY_STATUS_ADDRESS, data: calldata });
  if (!raw || raw === "0x") {
    return { address: clean, qorAddress: evmToQor(clean), registered: false, algorithm: 0, pubKeyBytes: 0 };
  }
  const [registered, algorithm, pubkey] = iface.decodeFunctionResult("pqcKeyStatus", raw);
  const pkHex = String(pubkey);
  const pubKeyBytes = pkHex.startsWith("0x") ? (pkHex.length - 2) / 2 : 0;
  return {
    address: clean,
    qorAddress: evmToQor(clean),
    registered: Boolean(registered),
    algorithm: Number(algorithm),
    pubKeyBytes,
  };
}

export async function resolveCosmosTxHash(txHash: string): Promise<string> {
  if (!txHash.startsWith("0x")) return txHash;
  const restBase = import.meta.env.DEV ? "/api/qore-rest" : REST_API_URL;
  const query = encodeURIComponent(`ethereum_tx.ethereumTxHash='${txHash}'`);
  try {
    const res = await fetch(`${restBase}/cosmos/tx/v1beta1/txs?query=${query}`, { method: "GET" });
    if (!res.ok) return txHash;
    const data = (await res.json()) as { tx_responses?: Array<{ txhash?: string }> };
    const cosmosHash = data.tx_responses?.[0]?.txhash;
    return cosmosHash && cosmosHash.length >= 64 ? cosmosHash : txHash;
  } catch {
    return txHash;
  }
}

export async function fetchEvmWindowStatus(address: string, relayerUrl = DEFAULT_RELAYER_URL): Promise<EvmWindowStatus> {
  const qorAddr = evmToQor(address);
  const restBase = import.meta.env.DEV ? "/api/qore-rest" : REST_API_URL;
  const targetUrl = relayerUrl
    ? `${relayerUrl.replace(/\/+$/, "")}/api/evm-window/${qorAddr}`
    : `${restBase}/qorechain/pqc/v1/evm_window/${qorAddr}`;

  try {
    const res = await fetch(targetUrl, { method: "GET" });
    if (!res.ok) {
      return {
        status: "error",
        remainingBlocks: "0",
        remainingTxs: "0",
        remainingValueUqor: "0",
        message: `Could not read EVM window (HTTP ${res.status}).`,
      };
    }
    const data = (await res.json()) as {
      found?: boolean;
      window?: { remaining_blocks?: string; remaining_txs?: string; remaining_value?: string };
    };
    if (!data.found || !data.window) {
      return {
        status: "closed",
        remainingBlocks: "0",
        remainingTxs: "0",
        remainingValueUqor: "0",
        message: "No open EVM window found. Open one in QoreX before sending EVM transactions.",
      };
    }
    const blocks = BigInt(data.window.remaining_blocks ?? "0");
    const txs = BigInt(data.window.remaining_txs ?? "0");
    const val = BigInt(data.window.remaining_value ?? "0");
    const isOpen = blocks > 0n && txs > 0n && val > 0n;
    return {
      status: isOpen ? "open" : "closed",
      remainingBlocks: blocks.toString(),
      remainingTxs: txs.toString(),
      remainingValueUqor: val.toString(),
      message: isOpen
        ? `Open (${blocks} blocks, ${txs} txs, ${val} uqor remaining)`
        : "EVM window is exhausted or expired. Open a fresh window in QoreX.",
    };
  } catch {
    return {
      status: "cors_blocked",
      remainingBlocks: "?",
      remainingTxs: "?",
      remainingValueUqor: "?",
      message: "Check or open your EVM window in the QoreX extension before sending EVM transactions.",
    };
  }
}

export async function fetchUserVaults(ownerAddress: string): Promise<string[]> {
  const factory = new Contract(FACTORY_ADDRESS, FACTORY_ABI, getReadProvider());
  const list = (await factory.vaultsOf(getAddress(ownerAddress))) as string[];
  return list.map((a) => getAddress(a));
}

export async function fetchFusdBalance(address: string): Promise<{ raw: bigint; decimals: number }> {
  const fusd = new Contract(FUSD_ADDRESS, ERC20_ABI, getReadProvider());
  const [raw, dec] = await Promise.all([fusd.balanceOf(getAddress(address)) as Promise<bigint>, fusd.decimals() as Promise<bigint>]);
  return { raw, decimals: Number(dec) };
}

export async function fetchVaultSnapshot(vaultAddress: string): Promise<VaultSnapshot> {
  const provider = getReadProvider();
  const clean = getAddress(vaultAddress);
  const vault = new Contract(clean, VAULT_ABI, provider);
  const fusd = new Contract(FUSD_ADDRESS, ERC20_ABI, provider);

  const [
    sovereignKeyHash,
    agentKey,
    windowExpiresAt,
    epochDuration,
    maxRiskScoreBps,
    requireRecipientPqc,
    frozen,
    policyNonce,
    qorLim,
    fusdLim,
    qorBalance,
    fusdBalance,
    fusdDecimalsRaw,
    latestBlock,
  ] = await Promise.all([
    vault.sovereignKeyHash() as Promise<string>,
    vault.agentKey() as Promise<string>,
    vault.windowExpiresAt() as Promise<bigint>,
    vault.epochDuration() as Promise<bigint>,
    vault.maxRiskScoreBps() as Promise<bigint>,
    vault.requireRecipientPqc() as Promise<boolean>,
    vault.frozen() as Promise<boolean>,
    vault.policyNonce() as Promise<bigint>,
    vault.assetLimits(ZERO_ADDRESS) as Promise<[boolean, bigint, bigint, bigint, bigint]>,
    vault.assetLimits(FUSD_ADDRESS) as Promise<[boolean, bigint, bigint, bigint, bigint]>,
    provider.getBalance(clean),
    fusd.balanceOf(clean) as Promise<bigint>,
    fusd.decimals() as Promise<bigint>,
    provider.getBlockNumber(),
  ]);

  const fusdDecimals = Number(fusdDecimalsRaw);
  const fromBlock = Math.max(0, latestBlock - 50_000);
  const rawLogs = await provider
    .getLogs({
      address: clean,
      fromBlock,
      toBlock: latestBlock,
    })
    .catch(() => []);

  const iface = new Interface(VAULT_ABI);
  const events: TimelineEvent[] = [];
  for (const log of rawLogs.slice(-25).reverse()) {
    try {
      const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
      if (!parsed) continue;
      let title = parsed.name;
      let detail = "";
      let kind: "agent_payment" | "other" = "other";
      let intentId: string | undefined;
      if (parsed.name === "Deposited") {
        title = "Deposited QOR";
        detail = `${formatEther(parsed.args[1] as bigint)} QOR from ${String(parsed.args[0]).slice(0, 8)}...`;
      } else if (parsed.name === "AuthenticatedAgentIntentExecuted") {
        const asset = String(parsed.args[1]).toLowerCase() === ZERO_ADDRESS ? "QOR" : "fUSD";
        const amt = asset === "QOR" ? formatEther(parsed.args[3] as bigint) : formatUnits(parsed.args[3] as bigint, fusdDecimals);
        title = "Agent payment executed";
        detail = `${amt} ${asset} to ${String(parsed.args[2]).slice(0, 10)}...`;
        kind = "agent_payment";
        intentId = String(parsed.args[0]);
      } else if (parsed.name === "PolicyConfigured") {
        const p = parsed.args[0] as { frozen: boolean; requireRecipientPqc: boolean };
        title = p.frozen ? "Vault frozen" : "Policy updated";
        detail = `Firewall: ${p.requireRecipientPqc ? "ON" : "OFF"}`;
      } else if (parsed.name === "AssetLimitSet") {
        const asset = String(parsed.args[0]).toLowerCase() === ZERO_ADDRESS ? "QOR" : "fUSD";
        title = `${asset} daily limit updated`;
        detail = parsed.args[1] ? "Enabled" : "Disabled";
      } else if (parsed.name === "EmergencyClawback") {
        title = "Emergency clawback";
        detail = `Revoked agent ${String(parsed.args[0]).slice(0, 8)}...`;
      } else if (parsed.name === "SovereignWithdrawal") {
        title = "Sovereign withdrawal";
        detail = `Sent to ${String(parsed.args[1]).slice(0, 10)}...`;
      }
      events.push({
        id: `${log.transactionHash}-${log.index}`,
        blockNumber: log.blockNumber,
        txHash: log.transactionHash,
        title,
        detail,
        kind,
        intentId,
      });
    } catch {
      // ignore unparsed logs
    }
  }

  // Resolve EVM tx hashes to QoreScan Cosmos tx hashes for the recent timeline (best-effort)
  await Promise.all(
    events.slice(0, 10).map(async (ev) => {
      ev.txHash = await resolveCosmosTxHash(ev.txHash);
    }),
  );

  return {
    address: clean,
    qorAddress: evmToQor(clean),
    sovereignKeyHash,
    agentKey: getAddress(agentKey),
    windowExpiresAt: Number(windowExpiresAt),
    epochDuration: Number(epochDuration),
    maxRiskScoreBps: Number(maxRiskScoreBps),
    requireRecipientPqc,
    frozen,
    policyNonce,
    qorBalance,
    fusdBalance,
    fusdDecimals,
    qorLimit: {
      enabled: qorLim[0],
      maxTxValue: qorLim[1],
      epochLimit: qorLim[2],
      epochSpent: qorLim[3],
      epochStart: qorLim[4],
    },
    fusdLimit: {
      enabled: fusdLim[0],
      maxTxValue: fusdLim[1],
      epochLimit: fusdLim[2],
      epochSpent: fusdLim[3],
      epochStart: fusdLim[4],
    },
    events,
  };
}

export interface AttackSimResult {
  id: string;
  label: string;
  blocked: boolean;
  errorName: string;
  explanation: string;
}

export async function runAttackSimulations(vault: VaultSnapshot): Promise<AttackSimResult[]> {
  const provider = getReadProvider();
  const iface = new Interface(VAULT_ABI);
  const now = Math.floor(Date.now() / 1000);
  const results: AttackSimResult[] = [];

  const simulate = async (id: string, label: string, from: string, data: string, explanation: string) => {
    try {
      await provider.call({ from, to: vault.address, data });
      results.push({ id, label, blocked: false, errorName: "NONE (would succeed)", explanation });
    } catch (err: unknown) {
      const errHex = extractRevertData(err);
      let errorName = "Reverted";
      if (errHex) {
        try {
          const decoded = iface.parseError(errHex);
          if (decoded) errorName = decoded.name;
        } catch {
          errorName = `Revert (${errHex.slice(0, 10)})`;
        }
      }
      results.push({ id, label, blocked: true, errorName, explanation });
    }
  };

  // 1. Over-spend simulation (10x per-payment cap)
  const overValue = vault.qorLimit.maxTxValue > 0n ? vault.qorLimit.maxTxValue * 10n : 10n ** 19n;
  const overData = iface.encodeFunctionData("executeScopedAgentIntent", [
    {
      intentId: keccak256(toUtf8Bytes(`sim-overspend-${now}`)),
      target: ZERO_ADDRESS,
      recipient: "0xD6891e4Ef67be07b5DE9703Dcc4cf36eF4D15aae",
      value: overValue,
      deadline: BigInt(now + 600),
      riskScoreBps: 0n,
      rationaleHash: keccak256(toUtf8Bytes("sim")),
    },
  ]);
  await simulate(
    "overspend",
    "Over-spend (10x per-payment limit)",
    vault.agentKey,
    overData,
    "Even with the valid hot agent key, requesting more than the per-payment cap is blocked on-chain.",
  );

  // 2. Non-PQC recipient
  const burner = "0x000000000000000000000000000000000000dEaD";
  const nonPqcData = iface.encodeFunctionData("executeScopedAgentIntent", [
    {
      intentId: keccak256(toUtf8Bytes(`sim-nonpqc-${now}`)),
      target: ZERO_ADDRESS,
      recipient: burner,
      value: vault.qorLimit.maxTxValue > 0n ? vault.qorLimit.maxTxValue / 2n || 1n : 1n,
      deadline: BigInt(now + 600),
      riskScoreBps: 0n,
      rationaleHash: keccak256(toUtf8Bytes("sim")),
    },
  ]);
  await simulate(
    "nonpqc",
    "Send to non-quantum-safe address (0x0A02)",
    vault.agentKey,
    nonPqcData,
    "The 0x0A02 firewall checks whether the recipient has a registered ML-DSA-87 key.",
  );

  // 3. Leaked key policy hijack (0x0A01)
  const coder = AbiCoder.defaultAbiCoder();
  const badPolicy = {
    agent: burner,
    windowExpiresAt: BigInt(now + 86400 * 365),
    epochDuration: BigInt(86400),
    maxRiskScoreBps: 10000n,
    requireRecipientPqc: false,
    frozen: false,
  };
  const hijackData = iface.encodeFunctionData("configurePolicy", [
    badPolicy,
    new Uint8Array(2592),
    new Uint8Array(4627),
  ]);
  void coder;
  await simulate(
    "hijack",
    "Leaked classical key tries to rewrite policy (0x0A01)",
    vault.agentKey,
    hijackData,
    "msg.sender has zero admin authority; without a valid ML-DSA-87 signature, 0x0A01 rejects the call.",
  );

  // 4. Leaked key drain (0x0A01)
  const drainData = iface.encodeFunctionData("sovereignWithdraw", [
    { asset: ZERO_ADDRESS, to: burner, amount: 1n },
    new Uint8Array(2592),
    new Uint8Array(4627),
  ]);
  await simulate(
    "drain",
    "Leaked classical key tries sovereignWithdraw (0x0A01)",
    vault.agentKey,
    drainData,
    "Sovereign withdrawals require ML-DSA-87 verification over the vault's chain-bound digest.",
  );

  return results;
}

function extractRevertData(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const e = err as { data?: string; info?: { error?: { data?: string } } };
  if (typeof e.data === "string" && e.data.startsWith("0x")) return e.data;
  if (typeof e.info?.error?.data === "string" && e.info.error.data.startsWith("0x")) return e.info.error.data;
  return null;
}

export async function signSovereignCall(
  vaultAddress: string,
  tagName: "TAG_CONFIGURE" | "TAG_ASSET" | "TAG_WITHDRAW" | "TAG_CLAWBACK" | "TAG_ROTATE",
  encodedParams: string,
  signer: SovereignSigner,
): Promise<{ pk: Uint8Array; sig: Uint8Array; digest: string }> {
  const vault = new Contract(vaultAddress, VAULT_ABI, getReadProvider());
  const tag = (await vault[tagName]()) as string;
  const digestHex = (await vault.sovereignDigest(tag, encodedParams)) as string;
  const digestBytes = new Uint8Array(
    digestHex
      .slice(2)
      .match(/.{2}/g)!
      .map((b) => parseInt(b, 16)),
  );
  const [pk, sig] = await Promise.all([signer.publicKey(), signer.sign(digestBytes)]);
  return { pk, sig, digest: digestHex };
}

export async function submitViaRelayerOrQoreX(opts: {
  relayerUrl?: string;
  vaultAddress: string;
  calldata: string;
  qorexEvmProvider: import("ethers").BrowserProvider | null;
}): Promise<{ txHash: string; via: "relayer" | "qorex" }> {
  const relayer = (opts.relayerUrl ?? DEFAULT_RELAYER_URL).trim().replace(/\/+$/, "");
  if (relayer) {
    try {
      const res = await fetch(`${relayer}/api/relay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: opts.vaultAddress, data: opts.calldata }),
      });
      if (res.ok) {
        const json = (await res.json()) as { txHash?: string };
        if (json.txHash) {
          return { txHash: json.txHash, via: "relayer" };
        }
      }
    } catch {
      // fall back to QoreX EVM provider cleanly
    }
  }

  if (!opts.qorexEvmProvider) {
    throw new Error(
      relayer
        ? "The testnet relayer is unavailable and QoreX EVM provider is not connected. Connect QoreX to submit this transaction."
        : "Connect QoreX (with an open EVM window) to submit this signed transaction.",
    );
  }
  const signer = await opts.qorexEvmProvider.getSigner();
  const from = await signer.getAddress();
  // Dry-run on the public RPC first, so a call the vault would reject fails here
  // with a decoded Solidity error name instead of after the user signs in QoreX.
  try {
    await getReadProvider().call({ from, to: opts.vaultAddress, data: opts.calldata });
  } catch (simErr: unknown) {
    const errHex = extractRevertData(simErr);
    if (errHex) {
      try {
        const decoded = new Interface(VAULT_ABI).parseError(errHex);
        if (decoded) {
          throw new Error(decoded.name);
        }
      } catch (inner) {
        if (inner instanceof Error && inner.message && !inner.message.includes("no matching error")) {
          throw inner;
        }
      }
    }
    throw simErr;
  }
  const tx = await signer.sendTransaction({ to: opts.vaultAddress, data: opts.calldata });
  const receipt = await tx.wait(1, 120_000);
  if (receipt && receipt.status === 0) {
    throw new Error("The transaction was mined but reverted on-chain.");
  }
  const explorerHash = await resolveCosmosTxHash(tx.hash);
  return { txHash: explorerHash, via: "qorex" };
}
