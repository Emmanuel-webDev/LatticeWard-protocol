import { getProvider } from "./config.js";

/**
 * QoreChain AI pre-flight gate (simulateWithRiskScore).
 *
 * FAIL-CLOSED and NO MOCKS: if the SDK call is unavailable, errors, or returns a score we cannot
 * interpret, the transaction is NOT sent.
 *
 * In @qorechain/sdk v0.7.0 (re-exported from @qorechain/evm v0.5.1), simulateWithRiskScore is exposed as:
 *   simulateWithRiskScore(client: PublicClient, tx: PreflightTx): Promise<PreflightResult>
 * (and on `sdk.ai.simulateWithRiskScore`), where `client` provides `{ estimateGas, call, getCode }`
 * and `PreflightResult` is `{ gas: bigint, risk: { score: bigint, level: number }, anomaly: { anomalyScore: bigint, flagged: boolean }, safe: boolean }`.
 */
export interface PreflightTx {
  from: string;
  to: string;
  data: string;
  value?: bigint;
}

export interface PreflightResult {
  safe: boolean;
  riskScore: number; // 0..1
  riskScoreBps: number; // 0..10000
  threshold: number;
  raw: unknown;
}

export class PreflightUnavailable extends Error {}

async function callSdk(tx: PreflightTx): Promise<unknown> {
  let sdk: Record<string, unknown>;
  try {
    // @ts-ignore optional dependency, resolved at runtime (requires peer dependency `viem`)
    sdk = (await import("@qorechain/sdk")) as Record<string, unknown>;
  } catch (e) {
    throw new PreflightUnavailable(`@qorechain/sdk unavailable: ${(e as Error).message}`);
  }
  const aiNs = sdk["ai"] as Record<string, unknown> | undefined;
  const fn = sdk["simulateWithRiskScore"] ?? aiNs?.["simulateWithRiskScore"];
  if (typeof fn !== "function") {
    throw new PreflightUnavailable("@qorechain/sdk does not export simulateWithRiskScore (check version / API shape)");
  }
  const provider = getProvider();
  const client = {
    estimateGas: async (a: { account?: string; to?: string; data?: string; value?: bigint }) =>
      provider.estimateGas({ from: a.account, to: a.to, data: a.data, value: a.value }),
    call: async (a: { to?: string; data?: string }) => ({
      data: await provider.call({ to: a.to, data: a.data }),
    }),
    getCode: async (a: { address: string }) => provider.getCode(a.address),
  };
  try {
    return await (fn as (c: unknown, t: unknown) => Promise<unknown>)(client, {
      from: tx.from,
      to: tx.to,
      data: tx.data,
      value: tx.value ?? 0n,
    });
  } catch (e) {
    throw new PreflightUnavailable(`simulateWithRiskScore call failed: ${(e as Error).message}`);
  }
}

function extractScore(raw: unknown): number {
  const o = raw as Record<string, unknown> | null;
  const candidates = [o?.riskScore, o?.risk_score, o?.score, (o?.risk as Record<string, unknown> | undefined)?.score];
  for (const c of candidates) {
    if (typeof c === "number" && Number.isFinite(c) && c >= 0 && c <= 1) return c;
  }
  throw new PreflightUnavailable(`could not read a 0..1 risk score from SDK response: ${JSON.stringify(raw)?.slice(0, 200)}`);
}

export async function preflight(
  tx: PreflightTx,
  threshold = Number(process.env.RISK_THRESHOLD ?? 0.3),
): Promise<PreflightResult> {
  const raw = await callSdk(tx);
  const riskScore = extractScore(raw);
  return {
    safe: riskScore < threshold,
    riskScore,
    riskScoreBps: Math.round(riskScore * 10_000),
    threshold,
    raw,
  };
}
