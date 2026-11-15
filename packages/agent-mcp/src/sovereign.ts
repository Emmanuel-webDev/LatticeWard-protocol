import { AbiCoder, Contract, Wallet, getBytes, id } from "ethers";
import { ASSET_TUPLE, CLAWBACK_TUPLE, POLICY_TUPLE, WITHDRAW_TUPLE } from "./abi.js";
import { env } from "./config.js";
import { pqcSign } from "./pqc.js";

const SPECS = {
  configurePolicy: { tag: "CONFIGURE_POLICY", tuple: POLICY_TUPLE },
  setAssetLimit: { tag: "SET_ASSET_LIMIT", tuple: ASSET_TUPLE },
  sovereignWithdraw: { tag: "SOVEREIGN_WITHDRAW", tuple: WITHDRAW_TUPLE },
  triggerQDayEmergencyClawback: { tag: "EMERGENCY_CLAWBACK", tuple: CLAWBACK_TUPLE },
  emergencyClawback: { tag: "EMERGENCY_CLAWBACK", tuple: CLAWBACK_TUPLE },
} as const;

export type SovereignMethod = keyof typeof SPECS;

export interface SovereignAuth {
  digest: string;
  pk: string;
  sig: string;
}

/**
 * Asks the CONTRACT for the digest (single source of truth, no off-chain re-implementation to drift),
 * then signs it with the ML-DSA-87 secret key. The digest is bound to chainid, vault, policyNonce and params,
 * so each signature is single-use and non-transferable between vaults/chains.
 */
export async function signSovereign(
  vault: Contract,
  method: SovereignMethod,
  value: Record<string, unknown>,
  keys?: { pk: string; sk: string },
): Promise<SovereignAuth> {
  const pk = keys?.pk ?? env("SOVEREIGN_PK_HEX");
  const sk = keys?.sk ?? env("SOVEREIGN_SK_HEX");
  const spec = SPECS[method];
  const params = AbiCoder.defaultAbiCoder().encode([spec.tuple], [value]);
  const digest: string = await vault.getFunction("sovereignDigest").staticCall(id(spec.tag), params);
  const sig = pqcSign(sk, pk, getBytes(digest));
  return { digest, pk, sig };
}

/** Signs and submits. Anyone can submit; authority comes from the ML-DSA signature, not msg.sender. */
export async function sendSovereign(
  vault: Contract,
  submitter: Wallet,
  method: SovereignMethod,
  value: Record<string, unknown>,
  keys?: { pk: string; sk: string },
): Promise<{ txHash: string; auth: SovereignAuth }> {
  const auth = await signSovereign(vault, method, value, keys);
  const tx = await vault.connect(submitter).getFunction(method)(value, auth.pk, auth.sig);
  const receipt = await tx.wait();
  return { txHash: receipt?.hash ?? tx.hash, auth };
}
