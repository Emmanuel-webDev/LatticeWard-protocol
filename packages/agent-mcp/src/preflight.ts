/**
 * QoreChain AI pre-flight gate (simulateWithRiskScore).
 *
 * FAIL-CLOSED and NO MOCKS: if the SDK call is unavailable, errors, or returns a score we cannot
 * interpret, the transaction is NOT sent.
 *
 * TODO(Sprint 1): confirm the exact @qorechain/sdk v0.7.0 export/signature for simulateWithRiskScore
 * and replace `callSdk` accordingly. Everything else in this file is SDK-agnostic.
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
    // @ts-ignore optional dependency, resolved at runtime
    sdk = (await import("@qorechain/sdk")) as Record<string, unknown>;
  } catch {
    throw new PreflightUnavailable("@qorechain/sdk is not installed");
  }
  const fn = sdk["simulateWithRiskScore"];
  if (typeof fn !== "function") {
    throw new PreflightUnavailable("@qorechain/sdk does not export simulateWithRiskScore (check version / API shape)");
  }
  return await (fn as (t: unknown) => Promise<unknown>)({ ...tx, value: tx.value?.toString() ?? "0" });
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
