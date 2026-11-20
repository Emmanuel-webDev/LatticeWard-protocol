import "dotenv/config";
import {
  EthNativeSigner,
  type EthBroadcaster,
  type UnifiedAccount,
  abstractaccount,
  decodeAuthenticatorExecutions,
  derivePqcLegacy,
  deriveUnifiedAccount,
  evmAuthSignBytesV2,
  executeEvmMsg,
  fetchAuthNonce,
  fetchAuthenticators,
  fetchPqcStatus,
  fetchSpendingRules,
  linkAuthenticatorMsgs,
  openEvmWindowMsg,
  pqcKeyFromRecoveryCode,
  pqcStatusPublicKey,
  qorechainRegistry,
  revokeAuthenticatorMsg,
  signAuthenticatorLinkEip191,
  toHex,
} from "@qorechain/sdk";
import { Wallet, getBytes } from "ethers";

export const DEFAULT_REST_URL = process.env.QOR_REST_API?.trim() || "https://api-testnet.qore.host";
export const DEFAULT_EVM_RPC = process.env.QOR_RPC_URL?.trim() || "https://evm-testnet.qore.host";
export const DEFAULT_COSMOS_CHAIN_ID = process.env.QOR_COSMOS_CHAIN_ID?.trim() || "qorechain-diana";
export const LIVE_VAULT_ADDRESS =
  process.env.VAULT_ADDRESS?.trim() || "0x9697a96058555b3A0C50b2338440C84B927caB29";

export interface AbstractAccountRuleConfig {
  id: string;
  perTxLimitUqor: string;
  dailyLimitUqor: string;
  allowedEvmCalls: string[];
  expiryUnix: number;
  label: string;
}

export const DEFAULT_AA_RULE_CONFIG: AbstractAccountRuleConfig = {
  id: "latticeward-vault-only",
  perTxLimitUqor: "100000", // 0.1 QOR (6 decimals in uqor)
  dailyLimitUqor: "300000", // 0.3 QOR (6 decimals in uqor)
  allowedEvmCalls: [LIVE_VAULT_ADDRESS],
  expiryUnix: Math.floor(Date.now() / 1000) + 86400, // 24h TTL
  label: "latticeward-scoped-agent",
};

export function createRestBroadcaster(restUrl = DEFAULT_REST_URL): EthBroadcaster {
  const base = restUrl.replace(/\/+$/, "");
  return {
    async broadcastTx(tx: Uint8Array, timeoutMs = 45_000, pollIntervalMs = 2_000) {
      const txBytesBase64 = Buffer.from(tx).toString("base64");
      const postRes = await fetch(`${base}/cosmos/tx/v1beta1/txs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tx_bytes: txBytesBase64,
          mode: "BROADCAST_MODE_SYNC",
        }),
      });
      if (!postRes.ok) {
        const body = await postRes.text();
        throw new Error(`Broadcast HTTP ${postRes.status}: ${body}`);
      }
      const postJson = (await postRes.json()) as {
        tx_response?: {
          code?: number;
          txhash?: string;
          raw_log?: string;
        };
      };
      const syncResp = postJson.tx_response;
      const txHash = syncResp?.txhash ?? "";
      if (!txHash) {
        throw new Error(`Missing txhash in broadcast response: ${JSON.stringify(postJson)}`);
      }
      if ((syncResp?.code ?? 0) !== 0) {
        return {
          code: syncResp!.code!,
          transactionHash: txHash,
          rawLog: syncResp?.raw_log,
        };
      }

      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, pollIntervalMs));
        const pollRes = await fetch(`${base}/cosmos/tx/v1beta1/txs/${txHash}`);
        if (!pollRes.ok) continue;
        const pollJson = (await pollRes.json()) as {
          tx_response?: {
            code?: number;
            txhash?: string;
            height?: string;
            gas_used?: string;
            gas_wanted?: string;
            raw_log?: string;
            events?: { type: string; attributes: { key: string; value: string }[] }[];
          };
        };
        const tr = pollJson.tx_response;
        if (tr && tr.height && Number(tr.height) > 0) {
          return {
            code: tr.code ?? 0,
            transactionHash: tr.txhash ?? txHash,
            height: Number(tr.height),
            gasUsed: tr.gas_used ? BigInt(tr.gas_used) : undefined,
            gasWanted: tr.gas_wanted ? BigInt(tr.gas_wanted) : undefined,
            rawLog: tr.raw_log,
            events: tr.events,
          };
        }
      }
      throw new Error(`Timed out waiting for tx ${txHash} to commit on-chain`);
    },
  };
}

export async function fetchAccountAuth(
  qorAddress: string,
  restUrl = DEFAULT_REST_URL,
): Promise<{ accountNumber: bigint; sequence: bigint }> {
  const base = restUrl.replace(/\/+$/, "");
  const res = await fetch(`${base}/cosmos/auth/v1beta1/accounts/${qorAddress}`);
  if (!res.ok) {
    throw new Error(`Failed to query account auth for ${qorAddress}: HTTP ${res.status}`);
  }
  const data = (await res.json()) as {
    account?: {
      account_number?: string;
      sequence?: string;
      base_account?: {
        account_number?: string;
        sequence?: string;
      };
    };
  };
  const accNum = data.account?.account_number ?? data.account?.base_account?.account_number ?? "0";
  const seq = data.account?.sequence ?? data.account?.base_account?.sequence ?? "0";
  return {
    accountNumber: BigInt(accNum),
    sequence: BigInt(seq),
  };
}

export async function loadHybridOwnerAccount(
  mnemonic: string,
  recoveryCode?: string,
  restUrl = DEFAULT_REST_URL,
): Promise<UnifiedAccount> {
  const account = await deriveUnifiedAccount(mnemonic.trim());
  if (recoveryCode?.trim()) {
    account.pqc = pqcKeyFromRecoveryCode(recoveryCode.trim(), account.cosmos);
  } else {
    const pqcStatus = await fetchPqcStatus({ rest: restUrl, address: account.cosmos });
    const onChainPk = pqcStatusPublicKey(pqcStatus);
    if (onChainPk && toHex(onChainPk) !== toHex(account.pqc.publicKey)) {
      const legacyPqc = derivePqcLegacy(mnemonic.trim());
      if (toHex(onChainPk) === toHex(legacyPqc.publicKey)) {
        account.pqc = legacyPqc;
      }
    }
  }
  return account;
}

export async function broadcastHybridCosmosMsgs(
  ownerAccount: UnifiedAccount,
  messages: { typeUrl: string; value: unknown }[],
  memo: string,
  gas = "450000",
  feeUqor = "45000",
  restUrl = DEFAULT_REST_URL,
  chainId = DEFAULT_COSMOS_CHAIN_ID,
) {
  const signer = new EthNativeSigner(ownerAccount, {
    registry: qorechainRegistry(),
    signMode: "hybrid",
    signBytesVersion: "auto",
    rest: restUrl,
  });
  const auth = await fetchAccountAuth(ownerAccount.cosmos, restUrl);
  const transport = createRestBroadcaster(restUrl);
  return signer.signAndBroadcast(transport, {
    chainId,
    accountNumber: auth.accountNumber,
    sequence: auth.sequence,
    messages,
    fee: {
      amount: [{ denom: "uqor", amount: feeUqor }],
      gas,
    },
    memo,
  });
}

export async function updateAbstractAccountSpendingRulesOnly(opts: {
  ownerAccount: UnifiedAccount;
  ruleConfig?: Partial<AbstractAccountRuleConfig>;
  restUrl?: string;
  chainId?: string;
}) {
  const restUrl = opts.restUrl ?? DEFAULT_REST_URL;
  const chainId = opts.chainId ?? DEFAULT_COSMOS_CHAIN_ID;
  const cfg: AbstractAccountRuleConfig = { ...DEFAULT_AA_RULE_CONFIG, ...opts.ruleConfig };

  const ruleMsg = abstractaccount.updateSpendingRules({
    owner: opts.ownerAccount.cosmos,
    accountAddress: opts.ownerAccount.cosmos,
    rules: [
      {
        id: cfg.id,
        enabled: true,
        perTxLimit: cfg.perTxLimitUqor,
        dailyLimit: cfg.dailyLimitUqor,
        allowedDenoms: ["uqor"],
        allowedEvmCalls: cfg.allowedEvmCalls,
        denomLimits: [
          {
            denom: "uqor",
            perTxLimit: cfg.perTxLimitUqor,
            dailyLimit: cfg.dailyLimitUqor,
          },
        ],
      },
    ],
  });

  const windowMsg = openEvmWindowMsg({
    sender: opts.ownerAccount.cosmos,
    blocks: 17280,
    maxTxs: 50,
    maxValue: cfg.dailyLimitUqor,
    nativeOnly: false,
    allowedTargets: cfg.allowedEvmCalls,
  });

  const res = await broadcastHybridCosmosMsgs(
    opts.ownerAccount,
    [ruleMsg, windowMsg],
    "LatticeWard x/abstractaccount spending rules + scoped EVM window",
    "450000",
    "45000",
    restUrl,
    chainId,
  );

  const rules = await fetchSpendingRules({ rest: restUrl, address: opts.ownerAccount.cosmos }).catch(() => ({
    rules: [],
    authenticatorRules: [],
  }));

  return {
    ownerCosmos: opts.ownerAccount.cosmos,
    ownerEvm: opts.ownerAccount.evm,
    txHash: res.transactionHash,
    height: res.height ?? 0,
    code: res.code,
    rawLog: res.rawLog ?? "",
    ruleConfig: cfg,
    onChainRules: rules,
  };
}

export async function setupAbstractAccountAndRules(opts: {
  ownerAccount: UnifiedAccount;
  agentPrivateKeyHex: string;
  ruleConfig?: Partial<AbstractAccountRuleConfig>;
  restUrl?: string;
  chainId?: string;
}) {
  const restUrl = opts.restUrl ?? DEFAULT_REST_URL;
  const chainId = opts.chainId ?? DEFAULT_COSMOS_CHAIN_ID;
  const cfg: AbstractAccountRuleConfig = { ...DEFAULT_AA_RULE_CONFIG, ...opts.ruleConfig };

  const agentPk = opts.agentPrivateKeyHex.startsWith("0x")
    ? opts.agentPrivateKeyHex
    : `0x${opts.agentPrivateKeyHex}`;
  const agentWallet = new Wallet(agentPk);

  // 1. Build proof of possession for the agent authenticator key (EIP-191 over authenticatorLinkMessage)
  const linkProof = signAuthenticatorLinkEip191({
    chainId,
    account: opts.ownerAccount.cosmos,
    privateKey: agentPk,
  });

  // 2. Build MsgUpdateSpendingRules + MsgRegisterAuthenticator via @qorechain/sdk linkAuthenticatorMsgs
  const linkMsgs = linkAuthenticatorMsgs({
    owner: opts.ownerAccount.cosmos,
    account: opts.ownerAccount.cosmos,
    chainId,
    scheme: linkProof.scheme,
    pubkey: linkProof.pubkey,
    permissions: ["evm", "send"],
    expiryUnix: cfg.expiryUnix,
    label: cfg.label,
    possessionProof: linkProof.possessionProof,
    spendingRule: {
      id: cfg.id,
      enabled: true,
      perTxLimit: cfg.perTxLimitUqor,
      dailyLimit: cfg.dailyLimitUqor,
      allowedDenoms: ["uqor"],
      allowedEvmCalls: cfg.allowedEvmCalls,
      denomLimits: [
        {
          denom: "uqor",
          perTxLimit: cfg.perTxLimitUqor,
          dailyLimit: cfg.dailyLimitUqor,
        },
      ],
    },
  });

  // 3. Also open a scoped EVM window restricted to the allowed targets
  const windowMsg = openEvmWindowMsg({
    sender: opts.ownerAccount.cosmos,
    blocks: 17280,
    maxTxs: 50,
    maxValue: cfg.dailyLimitUqor,
    nativeOnly: false,
    allowedTargets: cfg.allowedEvmCalls,
  });

  const res = await broadcastHybridCosmosMsgs(
    opts.ownerAccount,
    [...linkMsgs, windowMsg],
    "LatticeWard x/abstractaccount spending rules + authenticator link + scoped EVM window",
    "600000",
    "60000",
    restUrl,
    chainId,
  );

  const [rules, authenticators, authNonce] = await Promise.all([
    fetchSpendingRules({ rest: restUrl, address: opts.ownerAccount.cosmos }).catch(() => ({
      rules: [],
      authenticatorRules: [],
    })),
    fetchAuthenticators({ rest: restUrl, address: opts.ownerAccount.cosmos }).catch(() => []),
    fetchAuthNonce({
      rest: restUrl,
      address: opts.ownerAccount.cosmos,
      pubkey: linkProof.pubkey,
    }).catch(() => ({ nonce: 0n, linked: true })),
  ]);

  return {
    ownerCosmos: opts.ownerAccount.cosmos,
    ownerEvm: opts.ownerAccount.evm,
    agentEvm: agentWallet.address,
    pubkeyHex: toHex(linkProof.pubkey),
    txHash: res.transactionHash,
    height: res.height ?? 0,
    code: res.code,
    rawLog: res.rawLog ?? "",
    ruleConfig: cfg,
    onChainRules: rules,
    onChainAuthenticators: authenticators,
    authNonce: authNonce.nonce.toString(),
  };
}

export async function executeAuthenticatedEvmViaAbstractAccount(opts: {
  relayerAccount: UnifiedAccount;
  abstractAccountCosmos: string;
  agentPrivateKeyHex: string;
  to: string;
  valueWei?: string;
  dataHex?: string;
  gasLimit?: bigint;
  nonce?: bigint;
  restUrl?: string;
  chainId?: string;
}) {
  const restUrl = opts.restUrl ?? DEFAULT_REST_URL;
  const chainId = opts.chainId ?? DEFAULT_COSMOS_CHAIN_ID;
  const agentPk = opts.agentPrivateKeyHex.startsWith("0x")
    ? opts.agentPrivateKeyHex
    : `0x${opts.agentPrivateKeyHex}`;
  const agentWallet = new Wallet(agentPk);
  const pubkey = getBytes(agentWallet.address);
  const dataBytes = opts.dataHex && opts.dataHex !== "0x" ? getBytes(opts.dataHex) : new Uint8Array(0);
  const value = opts.valueWei ?? "0";
  const gasLimit = opts.gasLimit ?? 300_000n;

  const currentNonce =
    opts.nonce !== undefined
      ? opts.nonce
      : (
          await fetchAuthNonce({
            rest: restUrl,
            address: opts.abstractAccountCosmos,
            pubkey,
          })
        ).nonce;

  // Compute v2 authenticated EVM digest (binds chainId, account, pubkey, to, value, data, nonce, gasLimit)
  const digest = evmAuthSignBytesV2({
    chainId,
    account: opts.abstractAccountCosmos,
    pubkey,
    to: opts.to,
    value,
    data: dataBytes,
    nonce: currentNonce,
    gasLimit,
  });

  // EIP-191 personal_sign by the linked secp256k1 authenticator key
  const sigHex = await agentWallet.signMessage(digest);
  const signature = getBytes(sigHex);

  const msg = executeEvmMsg({
    relayer: opts.relayerAccount.cosmos,
    account: opts.abstractAccountCosmos,
    scheme: "secp256k1",
    pubkey,
    signature,
    to: opts.to,
    value,
    data: dataBytes,
    gasLimit,
    nonce: currentNonce,
  });

  const res = await broadcastHybridCosmosMsgs(
    opts.relayerAccount,
    [msg],
    "LatticeWard x/abstractaccount MsgExecuteEVM",
    "550000",
    "55000",
    restUrl,
    chainId,
  );

  const decoded = decodeAuthenticatorExecutions(res as never, [msg as never]);
  return {
    txHash: res.transactionHash,
    height: res.height ?? 0,
    code: res.code,
    rawLog: res.rawLog ?? "",
    nonceUsed: currentNonce.toString(),
    digestHex: "0x" + toHex(digest),
    signatureLen: signature.length,
    executionResult: decoded[0] ?? null,
    events: (res as { events?: unknown[] }).events ?? [],
  };
}

export async function revokeAgentAuthenticator(opts: {
  ownerAccount: UnifiedAccount;
  agentAddressHex: string;
  restUrl?: string;
  chainId?: string;
}) {
  const restUrl = opts.restUrl ?? DEFAULT_REST_URL;
  const chainId = opts.chainId ?? DEFAULT_COSMOS_CHAIN_ID;
  const pubkey = getBytes(opts.agentAddressHex);
  const msg = revokeAuthenticatorMsg({
    owner: opts.ownerAccount.cosmos,
    account: opts.ownerAccount.cosmos,
    scheme: "secp256k1",
    pubkey,
  });
  return broadcastHybridCosmosMsgs(
    opts.ownerAccount,
    [msg],
    "LatticeWard x/abstractaccount MsgRevokeAuthenticator",
    "350000",
    "35000",
    restUrl,
    chainId,
  );
}

export { abstractaccount, fetchAuthenticators, fetchSpendingRules, fetchAuthNonce };
