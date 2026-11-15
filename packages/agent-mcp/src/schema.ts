import { z } from "zod";

/**
 * Fail-closed intent grammar. The LLM (the MCP host) may only ever produce one of two shapes.
 * There is no field for policy, limits, keys, allowlists or requireRecipientPqc, and `.strict()`
 * rejects any extra key, so widening permissions is not expressible. Anything unparseable becomes
 * REJECT_OUT_OF_POLICY.
 */
const Address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x EVM address");
const Amount = z.string().regex(/^\d{1,18}(\.\d{1,18})?$/, "decimal string, max 18 decimals");

export const ExecuteWithinScope = z
  .object({
    action: z.literal("EXECUTE_WITHIN_SCOPE"),
    asset: z.enum(["fUSD", "QOR"]),
    recipient: Address,
    amount: Amount,
    rationale: z.string().min(1).max(500),
  })
  .strict();

export const RejectOutOfPolicy = z
  .object({
    action: z.literal("REJECT_OUT_OF_POLICY"),
    reason: z.string().max(300),
  })
  .strict();

export const AgentIntent = z.discriminatedUnion("action", [ExecuteWithinScope, RejectOutOfPolicy]);
export type AgentIntent = z.infer<typeof AgentIntent>;
export type ExecuteIntent = z.infer<typeof ExecuteWithinScope>;

export function parseIntentOrReject(raw: unknown): AgentIntent {
  const r = AgentIntent.safeParse(raw);
  if (r.success) return r.data;
  return {
    action: "REJECT_OUT_OF_POLICY",
    reason: `schema violation: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ").slice(0, 250)}`,
  };
}
