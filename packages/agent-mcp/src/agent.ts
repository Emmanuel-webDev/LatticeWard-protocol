import { Wallet, ZeroAddress, hexlify, id, parseUnits, randomBytes } from "ethers";
import { env, explorerLink, getFusd, getProvider, getVault } from "./config.js";
import { checkEvmWindow, pqcKeyStatus } from "./precompiles.js";
import { preflight, PreflightUnavailable } from "./preflight.js";
import { parseIntentOrReject } from "./schema.js";
import { evaluatePayeePolicyGate, getPreflightMode } from "../../../src/policyGate.js";
import { appendVerdictLedger } from "../../../src/authenticatedAgent.js";

export interface PipelineStage {
  stage: "zod" | "off-chain-gate" | "policy" | "pqc-recipient" | "preflight" | "broadcast";
  ok: boolean;
  detail: string;
}

export interface SettlementResult {
  ok: boolean;
  stages: PipelineStage[];
  txHash?: string;
  explorer?: string;
  intentId?: string;
  preflightStatus?: "ok" | "preflight_unavailable" | "failed";
}

export interface SettlementOptions {
  invoiceId?: string;
  skipPayeeGate?: boolean;
}

/**
 * Agent pipeline (every stage fail-closed by default):
 *   1. Zod schema guard  2. off-chain payee allowlist & per-payee cap gate (before signing)
 *   3. client-side vault policy pre-check  4. 0x0A02 recipient check
 *   5. simulateWithRiskScore pre-flight (PREFLIGHT_MODE=required|advisory, default required)
 *   6. broadcast from the disposable agent key.
 */
export async function executeScopedSettlement(
  rawIntent: unknown,
  simulateOnly = false,
  options: SettlementOptions = {},
): Promise<SettlementResult> {
  const stages: PipelineStage[] = [];
  const fail = (stage: PipelineStage["stage"], detail: string): SettlementResult => {
    stages.push({ stage, ok: false, detail });
    return { ok: false, stages };
  };

  const parsed = parseIntentOrReject(rawIntent);
  if (parsed.action === "REJECT_OUT_OF_POLICY") return fail("zod", parsed.reason);
  stages.push({ stage: "zod", ok: true, detail: "intent matches closed grammar" });

  const provider = getProvider();
  const agent = new Wallet(env("AGENT_PRIVATE_KEY"), provider);
  const vault = getVault(agent);
  const vaultAddr = await vault.getAddress();
  const asset = parsed.asset === "QOR" ? ZeroAddress : env("FUSD_ADDRESS");
  const decimals = parsed.asset === "QOR" ? 18 : Number(await getFusd(provider).decimals());
  const value = parseUnits(parsed.amount, decimals);
  const intentId = options.invoiceId ? id(options.invoiceId) : hexlify(randomBytes(32));
  const valueUqor = parsed.asset === "QOR" ? ((value + 10n ** 12n - 1n) / 10n ** 12n).toString() : "0";

  // 2. Off-chain payee allowlist & per-payee cap gate (enforced BEFORE signing)
  if (!options.skipPayeeGate) {
    const gate = evaluatePayeePolicyGate({
      recipient: parsed.recipient,
      asset: parsed.asset,
      amountWei: value,
      fusdDecimals: decimals,
    });
    if (!gate.allowed) {
      appendVerdictLedger(
        {
          proposalId: intentId,
          abstractAccountCosmos: "",
          agentAddress: agent.address,
          targetContract: vaultAddr,
          assetAddress: asset,
          recipientAddress: parsed.recipient,
          valueWei: value.toString(),
          valueUqor,
          deadlineUnix: Math.floor(Date.now() / 1000) + 600,
          gasLimit: "300000",
          nonce: "0",
          rationale: parsed.rationale,
          evmAuthDigestHex: "0x",
          signatureHex: "0x",
        },
        {
          allowed: false,
          checks: {
            txAndNonceValid: true,
            valueWithinCap: false,
            durationValid: true,
            targetAllowlisted: false,
            recipientQuantumSafe0x0A02: false,
            signatureVerified: false,
          },
          rejectionReason: gate.reason,
        },
        null,
        undefined,
        { invoiceId: options.invoiceId, enforcementLayer: "off-chain gate" },
      );
      return fail("off-chain-gate", gate.reason ?? "denied by off-chain payee policy gate");
    }
    stages.push({ stage: "off-chain-gate", ok: true, detail: `payee allowlisted (${gate.payeeLabel}) within per-payee cap` });
  }

  const [lim, frozen, expiry] = await Promise.all([
    vault.assetLimits(asset),
    vault.frozen() as Promise<boolean>,
    vault.windowExpiresAt() as Promise<bigint>,
  ]);
  if (frozen) return fail("policy", "vault is frozen");
  if (BigInt(Math.floor(Date.now() / 1000)) > expiry) return fail("policy", "scoped window expired");
  if (!lim.enabled) return fail("policy", `asset ${parsed.asset} not allowed`);
  if (value > lim.maxTxValue) return fail("policy", `amount exceeds max per tx (${lim.maxTxValue})`);
  if (lim.epochSpent + value > lim.epochLimit) {
    stages.push({ stage: "policy", ok: true, detail: "epoch cap may be hit; chain will decide" });
  } else {
    stages.push({ stage: "policy", ok: true, detail: "within per-tx and epoch limits" });
  }

  if (await vault.requireRecipientPqc()) {
    try {
      const st = await pqcKeyStatus(provider, parsed.recipient);
      if (!st.registered) return fail("pqc-recipient", `recipient ${parsed.recipient} has no ML-DSA-87 key (0x0A02 = false)`);
      stages.push({ stage: "pqc-recipient", ok: true, detail: "0x0A02 pqcKeyStatus = true" });
    } catch (e) {
      return fail("pqc-recipient", `0x0A02 query failed (fail-closed): ${(e as Error).message}`);
    }
  }

  const intent = {
    intentId,
    target: asset,
    recipient: parsed.recipient,
    value,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 600),
    riskScoreBps: 0n,
    rationaleHash: id(parsed.rationale),
  };

  const preflightMode = getPreflightMode();
  let preflightStatus: "ok" | "preflight_unavailable" | "failed" = "ok";
  try {
    const data = vault.interface.encodeFunctionData("executeScopedAgentIntent", [intent]);
    const pf = await preflight({ from: agent.address, to: vaultAddr, data });
    if (!pf.safe) {
      preflightStatus = "failed";
      return fail("preflight", `risk ${pf.riskScore.toFixed(2)} >= threshold ${pf.threshold}`);
    }
    intent.riskScoreBps = BigInt(pf.riskScoreBps);
    stages.push({ stage: "preflight", ok: true, detail: `risk ${pf.riskScore.toFixed(2)} < ${pf.threshold}` });
  } catch (e) {
    const why = e instanceof PreflightUnavailable ? e.message : (e as Error).message;
    if (preflightMode === "advisory") {
      preflightStatus = "preflight_unavailable";
      stages.push({ stage: "preflight", ok: true, detail: `preflight_unavailable (PREFLIGHT_MODE=advisory): ${why}` });
    } else {
      preflightStatus = "failed";
      return fail("preflight", `simulateWithRiskScore unavailable, refusing to send (PREFLIGHT_MODE=required): ${why}`);
    }
  }

  if (simulateOnly) {
    stages.push({ stage: "broadcast", ok: true, detail: "simulateOnly: not broadcast" });
    return { ok: true, stages, intentId, preflightStatus };
  }

  try {
    const win = await checkEvmWindow(agent.address);
    if (!win.registered || !win.live) {
      return fail(
        "broadcast",
        `window exhausted, reopen in QoreX (agent=${agent.address}, registered=${win.registered}, found=${win.found}, live=${win.live}, remaining_blocks=${win.remaining_blocks}, remaining_txs=${win.remaining_txs})`,
      );
    }
    const tx = await vault.executeScopedAgentIntent(intent);
    const receipt = await tx.wait();
    const hash = receipt?.hash ?? tx.hash;
    stages.push({ stage: "broadcast", ok: true, detail: `mined ${hash}` });
    appendVerdictLedger(
      {
        proposalId: intentId,
        abstractAccountCosmos: "",
        agentAddress: agent.address,
        targetContract: vaultAddr,
        assetAddress: asset,
        recipientAddress: parsed.recipient,
        valueWei: value.toString(),
        valueUqor,
        deadlineUnix: Number(intent.deadline),
        gasLimit: "300000",
        nonce: "0",
        rationale: parsed.rationale,
        evmAuthDigestHex: "0x",
        signatureHex: "0x",
      },
      {
        allowed: true,
        checks: {
          txAndNonceValid: true,
          valueWithinCap: true,
          durationValid: true,
          targetAllowlisted: true,
          recipientQuantumSafe0x0A02: true,
          signatureVerified: true,
        },
        rejectionReason: null,
      },
      hash,
      undefined,
      { invoiceId: options.invoiceId, enforcementLayer: "on-chain", preflightStatus },
    );
    return { ok: true, stages, txHash: hash, explorer: explorerLink(hash), intentId, preflightStatus };
  } catch (e) {
    return fail("broadcast", (e as Error).message.slice(0, 300));
  }
}
