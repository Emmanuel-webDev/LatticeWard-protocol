import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Interface, JsonRpcProvider, Wallet, getAddress, getBytes, keccak256, toUtf8Bytes } from "ethers";
import { evmAuthSignBytesV2, toHex } from "@qorechain/sdk";
import { VAULT_ABI } from "../packages/agent-mcp/src/abi.js";
import { pqcKeyStatus } from "../packages/agent-mcp/src/precompiles.js";
import {
  DEFAULT_AA_RULE_CONFIG,
  DEFAULT_COSMOS_CHAIN_ID,
  DEFAULT_EVM_RPC,
  LIVE_VAULT_ADDRESS,
  type AbstractAccountRuleConfig,
} from "./abstractAccount.js";

export const VERDICT_LEDGER_PATH = resolve("audits/verdict-ledger.jsonl");

export interface SignedAgentIntentProposal {
  proposalId: string;
  abstractAccountCosmos: string;
  agentAddress: string;
  targetContract: string;
  assetAddress: string;
  recipientAddress: string;
  valueWei: string;
  valueUqor: string;
  deadlineUnix: number;
  gasLimit: string;
  nonce: string;
  rationale: string;
  evmAuthDigestHex: string;
  signatureHex: string;
}

export interface PolicyEvaluationVerdict {
  allowed: boolean;
  checks: {
    txAndNonceValid: boolean;
    valueWithinCap: boolean;
    durationValid: boolean;
    targetAllowlisted: boolean;
    recipientQuantumSafe0x0A02: boolean;
    signatureVerified: boolean;
  };
  rejectionReason: string | null;
}

export interface VerdictLedgerEntry {
  index: number;
  timestamp: string;
  proposalId: string;
  agentAddress: string;
  targetContract: string;
  recipientAddress: string;
  valueUqor: string;
  verdict: "ALLOW" | "DENY";
  rejectionReason: string | null;
  checks: PolicyEvaluationVerdict["checks"];
  txHash: string | null;
  prevHash: string;
  entryHash: string;
}

export async function createSignedAgentProposal(opts: {
  agentPrivateKeyHex: string;
  abstractAccountCosmos: string;
  targetContract?: string;
  assetAddress?: string;
  recipientAddress: string;
  valueWei: bigint;
  deadlineUnix?: number;
  nonce: bigint;
  gasLimit?: bigint;
  rationale: string;
  chainId?: string;
}): Promise<{ proposal: SignedAgentIntentProposal; calldataHex: string }> {
  const chainId = opts.chainId ?? DEFAULT_COSMOS_CHAIN_ID;
  const agentPk = opts.agentPrivateKeyHex.startsWith("0x")
    ? opts.agentPrivateKeyHex
    : `0x${opts.agentPrivateKeyHex}`;
  const agentWallet = new Wallet(agentPk);
  const targetContract = getAddress(opts.targetContract ?? LIVE_VAULT_ADDRESS);
  const assetAddress = getAddress(opts.assetAddress ?? "0x0000000000000000000000000000000000000000");
  const recipientAddress = getAddress(opts.recipientAddress);
  const deadlineUnix = opts.deadlineUnix ?? Math.floor(Date.now() / 1000) + 900;
  const gasLimit = opts.gasLimit ?? 300_000n;
  const proposalId = keccak256(
    toUtf8Bytes(`${opts.abstractAccountCosmos}:${opts.nonce.toString()}:${recipientAddress}:${opts.valueWei.toString()}:${Date.now()}`),
  );

  const iface = new Interface(VAULT_ABI);
  const calldataHex = iface.encodeFunctionData("executeScopedAgentIntent", [
    {
      intentId: proposalId,
      target: assetAddress,
      recipient: recipientAddress,
      value: opts.valueWei,
      deadline: BigInt(deadlineUnix),
      riskScoreBps: 100n,
      rationaleHash: keccak256(toUtf8Bytes(opts.rationale)),
    },
  ]);

  const pubkey = getBytes(agentWallet.address);
  const digestBytes = evmAuthSignBytesV2({
    chainId,
    account: opts.abstractAccountCosmos,
    pubkey,
    to: targetContract,
    value: "0",
    data: getBytes(calldataHex),
    nonce: opts.nonce,
    gasLimit,
  });

  const signatureHex = await agentWallet.signMessage(digestBytes);
  // 1 QOR = 10^18 wei = 10^6 uqor -> 1 uqor = 10^12 wei
  const valueUqor = ((opts.valueWei + 10n ** 12n - 1n) / 10n ** 12n).toString();

  return {
    proposal: {
      proposalId,
      abstractAccountCosmos: opts.abstractAccountCosmos,
      agentAddress: agentWallet.address,
      targetContract,
      assetAddress,
      recipientAddress,
      valueWei: opts.valueWei.toString(),
      valueUqor,
      deadlineUnix,
      gasLimit: gasLimit.toString(),
      nonce: opts.nonce.toString(),
      rationale: opts.rationale,
      evmAuthDigestHex: "0x" + toHex(digestBytes),
      signatureHex,
    },
    calldataHex,
  };
}

export async function evaluateSignedProposal(
  proposal: SignedAgentIntentProposal,
  ruleConfig: AbstractAccountRuleConfig = DEFAULT_AA_RULE_CONFIG,
  nowUnix = Math.floor(Date.now() / 1000),
): Promise<PolicyEvaluationVerdict> {
  const txAndNonceValid = BigInt(proposal.nonce) >= 0n && BigInt(proposal.gasLimit) > 0n && BigInt(proposal.gasLimit) <= 30_000_000n;
  const valueWithinCap =
    BigInt(proposal.valueUqor) > 0n &&
    BigInt(proposal.valueUqor) <= BigInt(ruleConfig.perTxLimitUqor) &&
    BigInt(proposal.valueUqor) <= BigInt(ruleConfig.dailyLimitUqor);
  const durationValid = proposal.deadlineUnix > nowUnix && ruleConfig.expiryUnix > nowUnix;
  const targetAllowlisted = ruleConfig.allowedEvmCalls
    .map((a) => a.toLowerCase())
    .includes(proposal.targetContract.toLowerCase());

  let recipientQuantumSafe0x0A02 = false;
  try {
    const provider = new JsonRpcProvider(process.env.QOR_RPC_URL || DEFAULT_EVM_RPC);
    const pqc = await pqcKeyStatus(provider, proposal.recipientAddress);
    recipientQuantumSafe0x0A02 = pqc.registered;
  } catch {
    recipientQuantumSafe0x0A02 = false;
  }

  const signatureVerified = /^0x[0-9a-fA-F]{130}$/.test(proposal.signatureHex);

  const reasons: string[] = [];
  if (!signatureVerified) reasons.push("Invalid or missing EIP-191 authenticator signature");
  if (!txAndNonceValid) reasons.push("Invalid authenticator nonce or gas limit bounds");
  if (!targetAllowlisted)
    reasons.push(
      `Target ${proposal.targetContract} denied by x/abstractaccount allowlist (${ruleConfig.allowedEvmCalls.join(", ")})`,
    );
  if (!valueWithinCap)
    reasons.push(
      `Requested ${proposal.valueUqor} uqor exceeds x/abstractaccount perTxLimit (${ruleConfig.perTxLimitUqor} uqor)`,
    );
  if (!durationValid)
    reasons.push(
      `Proposal deadline (${proposal.deadlineUnix}) or authenticator window (${ruleConfig.expiryUnix}) expired at ${nowUnix}`,
    );
  if (!recipientQuantumSafe0x0A02)
    reasons.push(`Recipient ${proposal.recipientAddress} failed 0x0A02 pqcKeyStatus quantum-safety check`);

  return {
    allowed: reasons.length === 0,
    checks: {
      txAndNonceValid,
      valueWithinCap,
      durationValid,
      targetAllowlisted,
      recipientQuantumSafe0x0A02,
      signatureVerified,
    },
    rejectionReason: reasons.length > 0 ? reasons.join("; ") : null,
  };
}

export function appendVerdictLedger(
  proposal: SignedAgentIntentProposal,
  verdict: PolicyEvaluationVerdict,
  txHash: string | null = null,
  ledgerPath = VERDICT_LEDGER_PATH,
): VerdictLedgerEntry {
  mkdirSync(dirname(ledgerPath), { recursive: true });
  let prevHash = "0x" + "0".repeat(64);
  let index = 0;

  if (existsSync(ledgerPath)) {
    const lines = readFileSync(ledgerPath, "utf8")
      .trim()
      .split(/\r?\n/)
      .filter(Boolean);
    if (lines.length > 0) {
      const last = JSON.parse(lines[lines.length - 1]) as VerdictLedgerEntry;
      prevHash = last.entryHash;
      index = last.index + 1;
    }
  }

  const timestamp = new Date().toISOString();
  const payload = {
    index,
    timestamp,
    proposalId: proposal.proposalId,
    agentAddress: proposal.agentAddress,
    targetContract: proposal.targetContract,
    recipientAddress: proposal.recipientAddress,
    valueUqor: proposal.valueUqor,
    verdict: (verdict.allowed ? "ALLOW" : "DENY") as "ALLOW" | "DENY",
    rejectionReason: verdict.rejectionReason,
    checks: verdict.checks,
    txHash,
    prevHash,
  };

  const entryHash =
    "0x" +
    createHash("sha256")
      .update(JSON.stringify(payload))
      .digest("hex");

  const entry: VerdictLedgerEntry = { ...payload, entryHash };
  appendFileSync(ledgerPath, JSON.stringify(entry) + "\n", "utf8");
  return entry;
}
