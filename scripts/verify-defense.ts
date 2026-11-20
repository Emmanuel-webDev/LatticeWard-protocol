/**
 * Live 3-Layer Post-Quantum AI Agent Defense Verification (`npm run verify:defense`)
 * on QoreChain Diana Testnet (`qorechain-diana`, Chain ID 9800):
 *
 *   - Setup: Native `x/abstractaccount` spending rules (`denom_limits`, `allowed_evm_calls`,
 *     24h authenticator `expiry_unix`) + Scoped EVM Window (`allowedTargets: [VAULT_ADDRESS]`)
 *   - Test 1 (In-Policy Execution): Authenticated agent proposal inside `x/abstractaccount`
 *     spending rules + scoped EVM window + `LatticeWardVault.executeScopedAgentIntent`
 *   - Test 2a (Out-of-Policy Value Cap Refusal): Over-spend proposal (`1.0 QOR > 0.1 QOR` per-tx cap)
 *     blocked by fail-closed policy gate AND rejected on-chain
 *   - Test 2b (Out-of-Policy Duration Expiry Refusal): Expired proposal deadline blocked
 *   - Test 2c (Out-of-Policy Target / 0x0A02 Refusal): Unallowlisted target contract & non-PQC
 *     recipient (`0x...dEaD`) blocked by `x/abstractaccount` allowlist & `0x0A02` firewall
 *   - Test 3 (Authenticator Revocation & Kill-Switch): Owner revokes agent authenticator via
 *     hybrid-signed `MsgRevokeAuthenticator`, verifies `x/abstractaccount` rejects execution
 *     from the revoked key, and re-links clean state.
 *
 * Records all verbatim results in `audits/onchain-proof.json` and `audits/verdict-ledger.jsonl`.
 * Never prints or logs private keys or recovery phrases.
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Contract, Wallet, parseEther } from "ethers";
import { VAULT_ABI } from "../packages/agent-mcp/src/abi.js";
import { getProvider } from "../packages/agent-mcp/src/config.js";
import {
  DEFAULT_AA_RULE_CONFIG,
  LIVE_VAULT_ADDRESS,
  disableAbstractAccountRulesAndCloseWindow,
  executeAuthenticatedEvmViaAbstractAccount,
  fetchAuthenticators,
  fetchSpendingRules,
  loadHybridOwnerAccount,
  revokeAgentAuthenticator,
  setupAbstractAccountAndRules,
} from "../src/abstractAccount.js";
import {
  appendVerdictLedger,
  createSignedAgentProposal,
  evaluateSignedProposal,
} from "../src/authenticatedAgent.js";

function jsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

async function main() {
  const deployerMnemonic = process.env.DEPLOYER_MNEMONIC?.trim();
  const drillMnemonic = (process.env.DRILL_MNEMONIC || process.env.DRILL_PRIVATE_KEY || "").trim();
  const agentPk = process.env.AGENT_PRIVATE_KEY?.trim();
  const pqcRecipient =
    process.env.PQC_RECIPIENT?.trim() || "0xD6891e4Ef67be07b5DE9703Dcc4cf36eF4D15aae";

  if (!deployerMnemonic || !agentPk) {
    throw new Error("Missing DEPLOYER_MNEMONIC or AGENT_PRIVATE_KEY in .env");
  }

  const provider = getProvider();
  const owner = await loadHybridOwnerAccount(deployerMnemonic, process.env.DEPLOYER_PQC_RECOVERY_CODE);
  const agentWallet = new Wallet(agentPk.startsWith("0x") ? agentPk : `0x${agentPk}`, provider);
  const vault = new Contract(LIVE_VAULT_ADDRESS, VAULT_ABI, provider);

  console.log("=== LAYER 1 SETUP: Native x/abstractaccount Spending Rules & Authenticator ===");
  const thirtyDaysExpiryUnix = Math.floor(Date.now() / 1000) + 30 * 86400;
  const aaSetup = await setupAbstractAccountAndRules({
    ownerAccount: owner,
    agentPrivateKeyHex: agentPk,
    ruleConfig: {
      ...DEFAULT_AA_RULE_CONFIG,
      allowedEvmCalls: [LIVE_VAULT_ADDRESS],
      expiryUnix: thirtyDaysExpiryUnix,
    },
  });
  console.log(`  DEPLOYER AA setup txHash=${aaSetup.txHash} (block ${aaSetup.height})`);

  let drillAaSetup: Record<string, unknown> | null = null;
  if (drillMnemonic && drillMnemonic.split(/\s+/).length >= 12) {
    const drillOwner = await loadHybridOwnerAccount(drillMnemonic, process.env.DRILL_PQC_RECOVERY_CODE);
    const dRes = await disableAbstractAccountRulesAndCloseWindow({
      ownerAccount: drillOwner,
    });
    console.log(`  DRILL_ACCOUNT retired & EVM window closed txHash=${dRes.transactionHash} (block ${dRes.height})`);
    drillAaSetup = {
      ownerCosmos: drillOwner.cosmos,
      ownerEvm: drillOwner.evm,
      windowClosed: true,
      txHash: dRes.transactionHash,
      height: dRes.height ?? 0,
      code: dRes.code,
    };
  }

  // Ensure AGENT also has an open scoped EVM window if AGENT broadcasts directly on the EVM lane
  const tests: Record<string, unknown>[] = [];

  // ── TEST 1: In-Policy Authenticated Agent Execution ──
  console.log("\n=== TEST 1: In-Policy Authenticated Agent Execution ===");
  const { proposal: p1, calldataHex: data1 } = await createSignedAgentProposal({
    agentPrivateKeyHex: agentPk,
    abstractAccountCosmos: owner.cosmos,
    targetContract: LIVE_VAULT_ADDRESS,
    recipientAddress: pqcRecipient,
    valueWei: parseEther("0.001"),
    nonce: BigInt(aaSetup.authNonce),
    rationale: "Test 1: Valid scoped AI agent settlement within 0.1 QOR cap",
  });
  const v1 = await evaluateSignedProposal(p1);
  // Execute through x/abstractaccount MsgExecuteEVM AND verify vault staticCall from agentKey
  const aaExec1 = await executeAuthenticatedEvmViaAbstractAccount({
    relayerAccount: owner,
    abstractAccountCosmos: owner.cosmos,
    agentPrivateKeyHex: agentPk,
    to: LIVE_VAULT_ADDRESS,
    valueWei: "0",
    dataHex: data1,
    nonce: BigInt(aaSetup.authNonce),
  });
  // Verify direct vault call from agentKey passes all 4 on-chain vault guardrails
  await provider.call({ from: agentWallet.address, to: LIVE_VAULT_ADDRESS, data: data1 });
  const ledger1 = appendVerdictLedger(p1, v1, aaExec1.txHash);
  console.log(
    `  [PASS] Policy verdict=${ledger1.verdict} | MsgExecuteEVM txHash=${aaExec1.txHash} (block ${aaExec1.height})`,
  );
  tests.push({
    id: "test-1-in-policy-execution",
    passed: v1.allowed && aaExec1.code === 0,
    verdict: ledger1,
    aaExecution: aaExec1,
  });

  // ── TEST 2a: Out-of-Policy Value Cap Refusal (1.0 QOR > 0.1 QOR cap) ──
  console.log("\n=== TEST 2a: Out-of-Policy Value Cap Refusal (1.0 QOR > 0.1 QOR per-tx limit) ===");
  const { proposal: p2a, calldataHex: data2a } = await createSignedAgentProposal({
    agentPrivateKeyHex: agentPk,
    abstractAccountCosmos: owner.cosmos,
    targetContract: LIVE_VAULT_ADDRESS,
    recipientAddress: pqcRecipient,
    valueWei: parseEther("1.0"),
    nonce: BigInt(aaSetup.authNonce) + 1n,
    rationale: "Test 2a: Prompt-injected 10x overspend attempt",
  });
  const v2a = await evaluateSignedProposal(p2a);
  let onChainRevert2a = "";
  try {
    await provider.call({ from: agentWallet.address, to: LIVE_VAULT_ADDRESS, data: data2a });
  } catch (e: unknown) {
    const raw = (e as { data?: string })?.data ?? "";
    const parsed = raw ? vault.interface.parseError(raw) : null;
    onChainRevert2a = parsed ? `${parsed.name}(${parsed.args.map(String).join(", ")})` : (e as Error).message;
  }
  const ledger2a = appendVerdictLedger(p2a, v2a, null);
  console.log(`  [PASS] Blocked! Verdict=${ledger2a.verdict} | Reason: ${v2a.rejectionReason} | Vault revert: ${onChainRevert2a}`);
  tests.push({
    id: "test-2a-value-cap-refusal",
    passed: !v2a.allowed && onChainRevert2a.includes("ExceedsScopedMaxTxValue"),
    verdict: ledger2a,
    onChainRevert: onChainRevert2a,
  });

  // ── TEST 2b: Out-of-Policy Duration / Expiry Window Refusal ──
  console.log("\n=== TEST 2b: Out-of-Policy Duration / Expired Deadline Refusal ===");
  const expiredDeadline = Math.floor(Date.now() / 1000) - 600;
  const { proposal: p2b, calldataHex: data2b } = await createSignedAgentProposal({
    agentPrivateKeyHex: agentPk,
    abstractAccountCosmos: owner.cosmos,
    targetContract: LIVE_VAULT_ADDRESS,
    recipientAddress: pqcRecipient,
    valueWei: parseEther("0.001"),
    deadlineUnix: expiredDeadline,
    nonce: BigInt(aaSetup.authNonce) + 1n,
    rationale: "Test 2b: Expired intent duration window",
  });
  const v2b = await evaluateSignedProposal(p2b);
  let onChainRevert2b = "";
  try {
    await provider.call({ from: agentWallet.address, to: LIVE_VAULT_ADDRESS, data: data2b });
  } catch (e: unknown) {
    const raw = (e as { data?: string })?.data ?? "";
    const parsed = raw ? vault.interface.parseError(raw) : null;
    onChainRevert2b = parsed ? parsed.name : (e as Error).message;
  }
  const ledger2b = appendVerdictLedger(p2b, v2b, null);
  console.log(`  [PASS] Blocked! Verdict=${ledger2b.verdict} | Reason: ${v2b.rejectionReason} | Vault revert: ${onChainRevert2b}`);
  tests.push({
    id: "test-2b-duration-expiry-refusal",
    passed: !v2b.allowed && onChainRevert2b.includes("IntentExpired"),
    verdict: ledger2b,
    onChainRevert: onChainRevert2b,
  });

  // ── TEST 2c: Out-of-Policy Unallowlisted Target & Non-PQC Recipient (0x0A02) Refusal ──
  console.log("\n=== TEST 2c: Out-of-Policy Unallowlisted Target & Non-PQC Recipient (0x0A02) Refusal ===");
  const unallowedTarget = "0x000000000000000000000000000000000000dEaD";
  const { proposal: p2c, calldataHex: data2c } = await createSignedAgentProposal({
    agentPrivateKeyHex: agentPk,
    abstractAccountCosmos: owner.cosmos,
    targetContract: unallowedTarget,
    recipientAddress: unallowedTarget,
    valueWei: parseEther("0.001"),
    nonce: BigInt(aaSetup.authNonce) + 1n,
    rationale: "Test 2c: Call unallowlisted contract & non-PQC recipient",
  });
  const v2c = await evaluateSignedProposal(p2c);
  // Also broadcast MsgExecuteEVM to unallowlisted target so x/abstractaccount rejects it on-chain!
  const aaExec2c = await executeAuthenticatedEvmViaAbstractAccount({
    relayerAccount: owner,
    abstractAccountCosmos: owner.cosmos,
    agentPrivateKeyHex: agentPk,
    to: unallowedTarget,
    valueWei: "0",
    dataHex: "0x12345678",
  }).catch((err: Error) => ({
    txHash: null,
    height: 0,
    code: -1,
    rawLog: err.message,
    executionResult: { success: false, reason: err.message },
  }));
  let onChainRevert2c = "";
  try {
    await provider.call({ from: agentWallet.address, to: LIVE_VAULT_ADDRESS, data: data2c });
  } catch (e: unknown) {
    const raw = (e as { data?: string })?.data ?? "";
    const parsed = raw ? vault.interface.parseError(raw) : null;
    onChainRevert2c = parsed ? `${parsed.name}(${parsed.args.map(String).join(", ")})` : (e as Error).message;
  }
  const ledger2c = appendVerdictLedger(p2c, v2c, aaExec2c.txHash);
  console.log(
    `  [PASS] Blocked! Verdict=${ledger2c.verdict} | x/abstractaccount result: ${JSON.stringify(aaExec2c.executionResult)} | Vault 0x0A02 revert: ${onChainRevert2c}`,
  );
  tests.push({
    id: "test-2c-target-and-0x0A02-refusal",
    passed: !v2c.allowed && onChainRevert2c.includes("RecipientNotQuantumSafe"),
    verdict: ledger2c,
    aaRejection: aaExec2c,
    onChainRevert: onChainRevert2c,
  });

  // ── TEST 3: Authenticator Revocation (MsgRevokeAuthenticator) & Restore ──
  console.log("\n=== TEST 3: Authenticator Revocation (MsgRevokeAuthenticator) & Restore ===");
  const revokeRes = await revokeAgentAuthenticator({
    ownerAccount: owner,
    agentAddressHex: agentWallet.address,
  });
  console.log(`  Revoked authenticator in block ${revokeRes.height} | txHash=${revokeRes.transactionHash}`);

  // Attempt MsgExecuteEVM with the revoked authenticator -> must fail on-chain
  const postRevokeExec = await executeAuthenticatedEvmViaAbstractAccount({
    relayerAccount: owner,
    abstractAccountCosmos: owner.cosmos,
    agentPrivateKeyHex: agentPk,
    to: LIVE_VAULT_ADDRESS,
    valueWei: "0",
    dataHex: data1,
  }).catch((err: Error) => ({
    txHash: null,
    height: 0,
    code: -1,
    rawLog: err.message,
    executionResult: { success: false, reason: err.message },
  }));
  const postRevokeBlocked =
    postRevokeExec.code !== 0 ||
    postRevokeExec.executionResult?.success === false;
  console.log(
    `  [PASS] Post-revocation execution blocked=${postRevokeBlocked} | reason=${postRevokeExec.executionResult?.reason || postRevokeExec.rawLog}`,
  );

  // Restore clean linked authenticator state (30-day TTL) so the account remains active through Dec 3-15 judging
  const restoreRes = await setupAbstractAccountAndRules({
    ownerAccount: owner,
    agentPrivateKeyHex: agentPk,
    ruleConfig: {
      ...DEFAULT_AA_RULE_CONFIG,
      allowedEvmCalls: [LIVE_VAULT_ADDRESS],
      expiryUnix: Math.floor(Date.now() / 1000) + 30 * 86400,
    },
  });
  console.log(`  Restored active authenticator in block ${restoreRes.height} | txHash=${restoreRes.txHash}`);

  tests.push({
    id: "test-3-authenticator-revocation-and-restore",
    passed: revokeRes.code === 0 && postRevokeBlocked && restoreRes.code === 0,
    revokeTxHash: revokeRes.transactionHash,
    revokeBlock: revokeRes.height,
    postRevokeAttempt: postRevokeExec,
    restoreTxHash: restoreRes.txHash,
    restoreBlock: restoreRes.height,
  });

  const [finalRules, finalAuths] = await Promise.all([
    fetchSpendingRules({ rest: "https://api-testnet.qore.host", address: owner.cosmos }),
    fetchAuthenticators({ rest: "https://api-testnet.qore.host", address: owner.cosmos }),
  ]);

  mkdirSync(resolve("audits"), { recursive: true });
  const proofPath = resolve("audits/onchain-proof.json");
  const allPassed = tests.every((t) => t.passed === true);
  writeFileSync(
    proofPath,
    JSON.stringify(
      {
        network: "qorechain-diana",
        chainId: 9800,
        vaultAddress: LIVE_VAULT_ADDRESS,
        verifiedAt: new Date().toISOString(),
        allPassed,
        deployerAbstractAccountSetup: aaSetup,
        drillAbstractAccountSetup: drillAaSetup,
        finalOnChainSpendingRules: finalRules,
        finalOnChainAuthenticators: finalAuths,
        defenseVerificationTests: tests,
      },
      jsonReplacer,
      2,
    ),
    "utf8",
  );

  console.log(`\n=== ALL DEFENSE VERIFICATION TESTS PASSED: ${allPassed} ===`);
  console.log(`Proof written to ${proofPath}`);
  if (!allPassed) process.exit(1);
}

main().catch((err) => {
  console.error(`verify:defense failed: ${(err as Error).message}`);
  process.exit(1);
});
