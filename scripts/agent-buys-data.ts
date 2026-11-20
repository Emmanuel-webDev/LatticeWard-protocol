import "dotenv/config";
import { Wallet, id, parseEther } from "ethers";
import { executeScopedSettlement } from "../packages/agent-mcp/src/agent.js";
import { createSignedAgentProposal, appendVerdictLedger } from "../src/authenticatedAgent.js";
import { evaluatePayeePolicyGate, getPreflightMode } from "../src/policyGate.js";
import type { PaidApiInvoice } from "../examples/agent-pays-api/server.js";

const API_URL = (process.env.PAID_API_URL || "http://127.0.0.1:4020").replace(/\/+$/, "");
const DRY_RUN = process.argv.includes("--dry-run");
const OWNER_COSMOS = process.env.DEPLOYER_COSMOS || "qor1fqpxra6zk086tut9nkn045yfhkmvl59nlnegea";

async function main() {
  console.log("=== LatticeWard Agent-Pays-API Flow ===");
  console.log(`API: ${API_URL} | Mode: ${DRY_RUN ? "DRY-RUN" : "LIVE"} | PREFLIGHT_MODE: ${getPreflightMode()}`);

  // 1. Request protected resource without payment -> expect 402
  const firstRes = await fetch(`${API_URL}/data`);
  if (firstRes.status !== 402) {
    throw new Error(`Expected 402 Payment Required from ${API_URL}/data, got HTTP ${firstRes.status}`);
  }
  const invoice = (await firstRes.json()) as PaidApiInvoice;
  const intentId = id(invoice.invoiceId);
  const description = invoice.description || `Pay invoice ${invoice.invoiceId}`;
  console.log(`\n[1] Received 402 Invoice: ${invoice.invoiceId}`);
  console.log(`    Amount: ${invoice.amount} ${invoice.asset} -> Recipient: ${invoice.recipient}`);
  console.log(`    Binding: intentId=${intentId}`);

  // 2. Build signed agent proposal (EIP-191 evmAuthSignBytesV2) bound to invoiceId
  const agentPk = process.env.AGENT_PRIVATE_KEY?.trim();
  if (agentPk) {
    const { proposal } = await createSignedAgentProposal({
      agentPrivateKeyHex: agentPk,
      abstractAccountCosmos: OWNER_COSMOS,
      targetContract: invoice.vault,
      recipientAddress: invoice.recipient,
      valueWei: parseEther(invoice.amount),
      nonce: 0n,
      rationale: description,
      intentIdOverride: intentId,
    });
    console.log(`[2] Signed EIP-191 proposal (agent=${proposal.agentAddress}, digest=${proposal.evmAuthDigestHex.slice(0, 18)}...)`);
  } else {
    console.log("[2] AGENT_PRIVATE_KEY not set in .env; running off-chain policy gate + attack demo only.");
  }

  // 3. Off-chain policy gate (payee allowlist + per-payee caps) BEFORE signing/broadcasting
  const gate = evaluatePayeePolicyGate({
    recipient: invoice.recipient,
    asset: invoice.asset,
    amountWei: parseEther(invoice.amount),
  });
  console.log(`[3] Off-chain Policy Gate: ${gate.allowed ? "ALLOW" : "DENY"} (${gate.payeeLabel ?? gate.reason})`);
  if (!gate.allowed) {
    throw new Error(gate.reason || "Blocked by off-chain policy gate");
  }

  // 4. Execute payment from vault (or simulate in --dry-run)
  if (agentPk) {
    const res = await executeScopedSettlement(
      {
        action: "EXECUTE_WITHIN_SCOPE",
        asset: invoice.asset,
        recipient: invoice.recipient,
        amount: invoice.amount,
        rationale: description,
      },
      DRY_RUN,
      { invoiceId: invoice.invoiceId },
    );
    console.log(`[4] Settlement (${DRY_RUN ? "simulate" : "broadcast"}): ok=${res.ok}`);
    for (const s of res.stages) {
      console.log(`    - [${s.ok ? "OK" : "FAIL"}] ${s.stage}: ${s.detail}`);
    }
    if (!res.ok) {
      throw new Error("Settlement failed — see stages above.");
    }
    if (res.txHash) {
      console.log(`    Tx Hash: ${res.txHash}`);
      console.log(`    Explorer: ${res.explorer}`);
    }

    // 5. Retry GET /data?invoice=<id> after live payment
    if (!DRY_RUN) {
      const paidRes = await fetch(`${API_URL}/data?invoice=${encodeURIComponent(invoice.invoiceId)}`);
      const paidJson = await paidRes.json();
      console.log(`\n[5] Retry GET /data?invoice=${invoice.invoiceId} -> HTTP ${paidRes.status}`);
      console.log(JSON.stringify(paidJson, null, 2));

      // 6. Prove invoice reuse is rejected (409 Conflict)
      const replayRes = await fetch(`${API_URL}/data?invoice=${encodeURIComponent(invoice.invoiceId)}`);
      console.log(`[6] Replay check (same invoice) -> HTTP ${replayRes.status} (expected 409)`);
    }
  }

  // 7. Attack Demo: prompt-injected proposal to pay a non-allowlisted / non-PQ address
  console.log("\n=== Prompt-Injection Attack Demo ===");
  const attackerAddr = "0x000000000000000000000000000000000000dEaD";
  const attackInvoiceId = `attack-${Date.now()}`;
  const attackGate = evaluatePayeePolicyGate({
    recipient: attackerAddr,
    asset: "QOR",
    amountWei: parseEther("0.002"),
  });
  const demoAgentAddr = agentPk ? new Wallet(agentPk).address : "0xc40352672Ac28fD9DE498AbE2c3CedF9367FDE04";
  const ledgerEntry = appendVerdictLedger(
    {
      proposalId: id(attackInvoiceId),
      abstractAccountCosmos: OWNER_COSMOS,
      agentAddress: demoAgentAddr,
      targetContract: invoice.vault,
      assetAddress: "0x0000000000000000000000000000000000000000",
      recipientAddress: attackerAddr,
      valueWei: parseEther("0.002").toString(),
      valueUqor: "2000",
      deadlineUnix: Math.floor(Date.now() / 1000) + 600,
      gasLimit: "300000",
      nonce: "0",
      rationale: "Prompt-injected drain to non-allowlisted non-PQ address",
      evmAuthDigestHex: "0x",
      signatureHex: "0x",
    },
    {
      allowed: false,
      checks: {
        txAndNonceValid: true,
        valueWithinCap: true,
        durationValid: true,
        targetAllowlisted: false,
        recipientQuantumSafe0x0A02: false,
        signatureVerified: false,
      },
      rejectionReason: attackGate.reason ?? "Denied by off-chain gate (non-allowlisted & non-PQ recipient)",
    },
    null,
    undefined,
    { invoiceId: attackInvoiceId, enforcementLayer: "off-chain gate" },
  );
  console.log(`[ATTACK] Non-allowlisted / non-PQ target ${attackerAddr} -> ${ledgerEntry.verdict}`);
  console.log(`         Enforcement: ${ledgerEntry.enforcementLayer}`);
  console.log(`         Reason: ${ledgerEntry.rejectionReason}`);
  console.log(`         Ledger Entry #${ledgerEntry.index} hash: ${ledgerEntry.entryHash}`);
}

main().catch((err) => {
  console.error("[agent-buys-data] Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
