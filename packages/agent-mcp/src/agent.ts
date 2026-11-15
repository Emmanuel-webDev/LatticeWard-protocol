import { Wallet, ZeroAddress, hexlify, id, parseUnits, randomBytes } from "ethers";
import { env, explorerLink, getProvider, getVault } from "./config.js";
import { pqcKeyStatus } from "./precompiles.js";
import { preflight, PreflightUnavailable } from "./preflight.js";
import { parseIntentOrReject } from "./schema.js";

export interface PipelineStage {
  stage: "zod" | "policy" | "pqc-recipient" | "preflight" | "broadcast";
  ok: boolean;
  detail: string;
}

export interface SettlementResult {
  ok: boolean;
  stages: PipelineStage[];
  txHash?: string;
  explorer?: string;
  intentId?: string;
}

/**
 * Agent pipeline (every stage fail-closed):
 *   1. Zod schema guard  2. client-side policy pre-check (mirrors on-chain limits)
 *   3. 0x0A02 recipient check  4. simulateWithRiskScore pre-flight  5. broadcast from the disposable agent key.
 * The on-chain vault re-enforces 2 and 3 regardless, so client-side stages are defence in depth, not the trust anchor.
 */
export async function executeScopedSettlement(rawIntent: unknown, simulateOnly = false): Promise<SettlementResult> {
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
  const asset = parsed.asset === "QOR" ? ZeroAddress : env("FUSD_ADDRESS");
  const value = parseUnits(parsed.amount, 18); // assumes 18 decimals for fUSD and QOR; confirm on testnet

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
    // epoch may have rolled on-chain; this is advisory only
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

  const intentId = hexlify(randomBytes(32));
  const intent = {
    intentId,
    target: asset,
    recipient: parsed.recipient,
    value,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 600),
    riskScoreBps: 0n,
    rationaleHash: id(parsed.rationale),
  };

  try {
    const data = vault.interface.encodeFunctionData("executeScopedAgentIntent", [intent]);
    const pf = await preflight({ from: agent.address, to: await vault.getAddress(), data });
    if (!pf.safe) return fail("preflight", `risk ${pf.riskScore.toFixed(2)} >= threshold ${pf.threshold}`);
    intent.riskScoreBps = BigInt(pf.riskScoreBps);
    stages.push({ stage: "preflight", ok: true, detail: `risk ${pf.riskScore.toFixed(2)} < ${pf.threshold}` });
  } catch (e) {
    const why = e instanceof PreflightUnavailable ? e.message : (e as Error).message;
    return fail("preflight", `simulateWithRiskScore unavailable, refusing to send (fail-closed): ${why}`);
  }

  if (simulateOnly) {
    stages.push({ stage: "broadcast", ok: true, detail: "simulateOnly: not broadcast" });
    return { ok: true, stages, intentId };
  }

  try {
    const tx = await vault.executeScopedAgentIntent(intent);
    const receipt = await tx.wait();
    const hash = receipt?.hash ?? tx.hash;
    stages.push({ stage: "broadcast", ok: true, detail: `mined ${hash}` });
    return { ok: true, stages, txHash: hash, explorer: explorerLink(hash), intentId };
  } catch (e) {
    return fail("broadcast", (e as Error).message.slice(0, 300));
  }
}
