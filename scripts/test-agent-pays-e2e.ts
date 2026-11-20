import assert from "node:assert/strict";
import { id, parseEther } from "ethers";
import { createPaidApiServer, type PaidApiInvoice } from "../examples/agent-pays-api/server.js";
import { evaluatePayeePolicyGate, getPreflightMode } from "../src/policyGate.js";
import { appendVerdictLedger } from "../src/authenticatedAgent.js";

async function main() {
  let passed = 0;
  const test = async (name: string, fn: () => Promise<void> | void) => {
    await fn();
    console.log(`PASS: ${name}`);
    passed++;
  };

  // Create paid API with controllable on-chain verifier (in-process handler, zero TCP socket needed)
  let paidInvoiceId: string | null = null;
  const mockTxHash = "0x" + "ab".repeat(32);
  const { handleRequest } = createPaidApiServer({
    verifyOnChain: async (inv: PaidApiInvoice) => {
      if (inv.invoiceId === paidInvoiceId) {
        return { paid: true, txHash: mockTxHash, blockNumber: 10420000 };
      }
      return { paid: false, reason: "Not paid yet" };
    },
  });

  let invoice!: PaidApiInvoice;

  await test("1. GET /data without payment returns 402 with invoice fields", async () => {
    const res = await handleRequest("GET", "/data");
    assert.equal(res.status, 402);
    invoice = res.body as unknown as PaidApiInvoice;
    assert.ok(invoice.invoiceId.startsWith("inv-"));
    assert.equal(invoice.asset, "QOR");
    assert.equal(invoice.vault, "0x9697a96058555b3A0C50b2338440C84B927caB29");
    assert.equal(invoice.recipient, "0xD6891e4Ef67be07b5DE9703Dcc4cf36eF4D15aae");
    assert.equal(invoice.chainId, 9800);
  });

  await test("2. GET /data?invoice=<id> before payment returns 402", async () => {
    const res = await handleRequest("GET", `/data?invoice=${encodeURIComponent(invoice.invoiceId)}`);
    assert.equal(res.status, 402);
  });

  await test("3. Off-chain policy gate ALLOWS allowlisted 0x0A02 payee within cap", () => {
    const gate = evaluatePayeePolicyGate({
      recipient: invoice.recipient,
      asset: "QOR",
      amountWei: parseEther(invoice.amount),
    });
    assert.equal(gate.allowed, true);
    assert.equal(gate.enforcementLayer, "off-chain gate");
    assert.equal(getPreflightMode(), "required");
  });

  await test("4. Off-chain policy gate DENIES over-per-payee cap (0.08 QOR > 0.05 QOR)", () => {
    const gate = evaluatePayeePolicyGate({
      recipient: invoice.recipient,
      asset: "QOR",
      amountWei: parseEther("0.08"),
    });
    assert.equal(gate.allowed, false);
    assert.ok(gate.reason?.includes("per-payee tx cap"));
  });

  await test("5. Prompt-injected non-allowlisted / non-PQ payee DENIED and logged to verdict ledger", () => {
    const attacker = "0x000000000000000000000000000000000000dEaD";
    const attackInvoiceId = `prompt-inject-${Date.now()}`;
    const gate = evaluatePayeePolicyGate({
      recipient: attacker,
      asset: "QOR",
      amountWei: parseEther("0.002"),
    });
    assert.equal(gate.allowed, false);
    assert.ok(gate.reason?.includes("not in payee allowlist"));

    const entry = appendVerdictLedger(
      {
        proposalId: id(attackInvoiceId),
        abstractAccountCosmos: "qor1fqpxra6zk086tut9nkn045yfhkmvl59nlnegea",
        agentAddress: "0xc40352672Ac28fD9DE498AbE2c3CedF9367FDE04",
        targetContract: invoice.vault,
        assetAddress: "0x0000000000000000000000000000000000000000",
        recipientAddress: attacker,
        valueWei: parseEther("0.002").toString(),
        valueUqor: "2000",
        deadlineUnix: Math.floor(Date.now() / 1000) + 600,
        gasLimit: "300000",
        nonce: "0",
        rationale: "Prompt-injected payout to non-allowlisted non-PQ address",
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
        rejectionReason: gate.reason,
      },
      null,
      undefined,
      { invoiceId: attackInvoiceId, enforcementLayer: "off-chain gate" },
    );
    assert.equal(entry.verdict, "DENY");
    assert.equal(entry.enforcementLayer, "off-chain gate");
    assert.equal(entry.invoiceId, attackInvoiceId);
  });

  await test("6. GET /data?invoice=<id> after payment returns 200 with data and intentId binding", async () => {
    paidInvoiceId = invoice.invoiceId;
    const res = await handleRequest("GET", `/data?invoice=${encodeURIComponent(invoice.invoiceId)}`);
    assert.equal(res.status, 200);
    const body = res.body as { paid: boolean; intentId: string; txHash: string; data: { feed: string } };
    assert.equal(body.paid, true);
    assert.equal(body.intentId, id(invoice.invoiceId));
    assert.equal(body.txHash, mockTxHash);
    assert.equal(body.data.feed, "qorechain-qday-threat-intel-v1");
  });

  await test("7. Reusing the same invoice is rejected with 409 Conflict", async () => {
    const res = await handleRequest("GET", `/data?invoice=${encodeURIComponent(invoice.invoiceId)}`);
    assert.equal(res.status, 409);
    const body = res.body as { error: string };
    assert.equal(body.error, "invoice_already_used");
  });

  console.log(`\nALL AGENT-PAYS-API E2E TESTS PASSED: ${passed}/7`);
}

main().catch((err) => {
  console.error("TEST FAILED:", err);
  process.exit(1);
});
