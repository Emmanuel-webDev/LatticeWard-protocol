import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getAddress, parseEther, parseUnits } from "ethers";
import { VERDICT_LEDGER_PATH, type VerdictLedgerEntry } from "./authenticatedAgent.js";

export type PreflightMode = "required" | "advisory";

export interface PayeePolicyEntry {
  address: string;
  label: string;
  maxTxQor: string;
  maxDailyQor: string;
  maxTxFusd: string;
  maxDailyFusd: string;
}

export interface PayeePolicyConfig {
  version: number;
  description: string;
  defaultPreflightMode: PreflightMode;
  payees: PayeePolicyEntry[];
}

export interface OffChainGateVerdict {
  allowed: boolean;
  enforcementLayer: "off-chain gate";
  payeeLabel: string | null;
  reason: string | null;
  preflightMode: PreflightMode;
}

export const DEFAULT_PAYEE_POLICY_PATH = resolve("config/payee-policy.json");

export function getPreflightMode(): PreflightMode {
  const raw = (process.env.PREFLIGHT_MODE || "required").trim().toLowerCase();
  if (raw === "advisory") return "advisory";
  return "required";
}

export function loadPayeePolicy(policyPath = process.env.PAYEE_POLICY_PATH || DEFAULT_PAYEE_POLICY_PATH): PayeePolicyConfig {
  const raw = readFileSync(resolve(policyPath), "utf8");
  return JSON.parse(raw) as PayeePolicyConfig;
}

function spentTodayForPayeeWei(recipientAddress: string, asset: "QOR" | "fUSD", ledgerPath = VERDICT_LEDGER_PATH): bigint {
  if (!existsSync(ledgerPath)) return 0n;
  const cutoffMs = Date.now() - 24 * 60 * 60 * 1000;
  const target = recipientAddress.toLowerCase();
  let total = 0n;
  const lines = readFileSync(ledgerPath, "utf8")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);

  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as VerdictLedgerEntry;
      if (entry.verdict !== "ALLOW" || !entry.txHash) continue;
      if (entry.recipientAddress.toLowerCase() !== target) continue;
      const ts = Date.parse(entry.timestamp);
      if (Number.isNaN(ts) || ts < cutoffMs) continue;
      if (asset === "QOR") {
        // valueUqor -> wei (1 uqor = 10^12 wei)
        total += BigInt(entry.valueUqor || "0") * 10n ** 12n;
      }
    } catch {
      // ignore malformed lines
    }
  }
  return total;
}

export function evaluatePayeePolicyGate(opts: {
  recipient: string;
  asset: "QOR" | "fUSD";
  amountWei: bigint;
  fusdDecimals?: number;
  policyPath?: string;
  ledgerPath?: string;
}): OffChainGateVerdict {
  const preflightMode = getPreflightMode();
  const cfg = loadPayeePolicy(opts.policyPath);
  const cleanRecipient = getAddress(opts.recipient);

  const entry = cfg.payees.find((p) => p.address.toLowerCase() === cleanRecipient.toLowerCase());
  if (!entry) {
    return {
      allowed: false,
      enforcementLayer: "off-chain gate",
      payeeLabel: null,
      reason: `Off-chain gate denied: recipient ${cleanRecipient} is not in payee allowlist (config/payee-policy.json)`,
      preflightMode,
    };
  }

  const dec = opts.fusdDecimals ?? 6;
  const maxTx = opts.asset === "QOR" ? parseEther(entry.maxTxQor) : parseUnits(entry.maxTxFusd, dec);
  const maxDaily = opts.asset === "QOR" ? parseEther(entry.maxDailyQor) : parseUnits(entry.maxDailyFusd, dec);

  if (opts.amountWei <= 0n) {
    return {
      allowed: false,
      enforcementLayer: "off-chain gate",
      payeeLabel: entry.label,
      reason: "Off-chain gate denied: payment amount must be > 0",
      preflightMode,
    };
  }

  if (opts.amountWei > maxTx) {
    return {
      allowed: false,
      enforcementLayer: "off-chain gate",
      payeeLabel: entry.label,
      reason: `Off-chain gate denied: amount exceeds per-payee tx cap for ${entry.label} (${opts.asset === "QOR" ? entry.maxTxQor : entry.maxTxFusd} ${opts.asset})`,
      preflightMode,
    };
  }

  const spentToday = spentTodayForPayeeWei(cleanRecipient, opts.asset, opts.ledgerPath);
  if (spentToday + opts.amountWei > maxDaily) {
    return {
      allowed: false,
      enforcementLayer: "off-chain gate",
      payeeLabel: entry.label,
      reason: `Off-chain gate denied: would exceed 24h per-payee daily cap for ${entry.label} (${opts.asset === "QOR" ? entry.maxDailyQor : entry.maxDailyFusd} ${opts.asset})`,
      preflightMode,
    };
  }

  return {
    allowed: true,
    enforcementLayer: "off-chain gate",
    payeeLabel: entry.label,
    reason: null,
    preflightMode,
  };
}
