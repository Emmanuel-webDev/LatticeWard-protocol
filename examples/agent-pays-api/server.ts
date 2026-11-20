import "dotenv/config";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { Interface, JsonRpcProvider, ZeroAddress, getAddress, id, parseEther, parseUnits } from "ethers";
import { VAULT_ABI } from "../../packages/agent-mcp/src/abi.js";
import { pqcKeyStatus } from "../../packages/agent-mcp/src/precompiles.js";

export interface PaidApiInvoice {
  invoiceId: string;
  amount: string;
  asset: "QOR" | "fUSD";
  recipient: string;
  vault: string;
  chainId: number;
  description: string;
  createdAt: string;
}

export interface PaidApiOptions {
  port?: number;
  rpcUrl?: string;
  vaultAddress?: string;
  recipientAddress?: string;
  fusdAddress?: string;
  priceQor?: string;
  /** Optional custom verifier for offline unit tests. */
  verifyOnChain?: (invoice: PaidApiInvoice) => Promise<{ paid: boolean; txHash?: string; blockNumber?: number; reason?: string }>;
}

const DEFAULT_VAULT = process.env.VAULT_ADDRESS?.trim() || "0x9697a96058555b3A0C50b2338440C84B927caB29";
const DEFAULT_RECIPIENT = process.env.PQC_RECIPIENT?.trim() || "0xD6891e4Ef67be07b5DE9703Dcc4cf36eF4D15aae";
const DEFAULT_FUSD = process.env.FUSD_ADDRESS?.trim() || "0x97143B771D34ddb9130b807b135Ae675A5a963CA";
const DEFAULT_RPC = process.env.QOR_RPC_URL?.trim() || "https://evm-testnet.qore.host";
const CHAIN_ID = 9800;

export function createPaidApiServer(opts: PaidApiOptions = {}) {
  const vault = getAddress(opts.vaultAddress ?? DEFAULT_VAULT);
  const recipient = getAddress(opts.recipientAddress ?? DEFAULT_RECIPIENT);
  const fusdAddress = getAddress(opts.fusdAddress ?? DEFAULT_FUSD);
  const rpcUrl = opts.rpcUrl ?? DEFAULT_RPC;
  const priceQor = opts.priceQor ?? "0.002";

  const invoices = new Map<string, PaidApiInvoice>();
  const redeemed = new Set<string>();
  const iface = new Interface(VAULT_ABI);
  const eventTopic = iface.getEvent("AuthenticatedAgentIntentExecuted")!.topicHash;

  const defaultVerifyOnChain = async (
    inv: PaidApiInvoice,
  ): Promise<{ paid: boolean; txHash?: string; blockNumber?: number; reason?: string }> => {
    const provider = new JsonRpcProvider(rpcUrl, { chainId: CHAIN_ID, name: "QoreChain Diana Testnet" }, { staticNetwork: true, batchMaxCount: 1 } as never);

    // Ensure recipient has a registered ML-DSA-87 key on 0x0A02
    const pqc = await pqcKeyStatus(provider, inv.recipient);
    if (!pqc.registered) {
      return { paid: false, reason: `Recipient ${inv.recipient} is not registered on 0x0A02` };
    }

    const expectedHash = id(inv.invoiceId).toLowerCase();
    const expectedAsset = inv.asset === "QOR" ? ZeroAddress : fusdAddress;
    const expectedAmount = inv.asset === "QOR" ? parseEther(inv.amount) : parseUnits(inv.amount, 6);

    const latest = await provider.getBlockNumber();
    const fromBlock = Math.max(0, latest - 10_000);
    const logs = await provider.getLogs({
      address: vault,
      topics: [eventTopic],
      fromBlock,
      toBlock: latest,
    });

    for (const log of logs.reverse()) {
      try {
        const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
        if (!parsed || parsed.name !== "AuthenticatedAgentIntentExecuted") continue;
        const intentId = String(parsed.args[0]).toLowerCase();
        const target = getAddress(String(parsed.args[1]));
        const logRecipient = getAddress(String(parsed.args[2]));
        const value = parsed.args[3] as bigint;
        const rationaleHash = String(parsed.args[5]).toLowerCase();

        const matchesInvoice = intentId === expectedHash || rationaleHash === expectedHash;
        const matchesAsset = target.toLowerCase() === expectedAsset.toLowerCase();
        const matchesRecipient = logRecipient.toLowerCase() === inv.recipient.toLowerCase();
        const matchesAmount = value >= expectedAmount;

        if (matchesInvoice && matchesAsset && matchesRecipient && matchesAmount) {
          return { paid: true, txHash: log.transactionHash, blockNumber: log.blockNumber };
        }
      } catch {
        // skip unparseable logs
      }
    }

    return { paid: false, reason: "No matching AuthenticatedAgentIntentExecuted event found on-chain yet" };
  };

  const verifyFn = opts.verifyOnChain ?? defaultVerifyOnChain;

  const sendJson = (res: ServerResponse, status: number, body: unknown) => {
    const payload = JSON.stringify(body, null, 2);
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
    });
    res.end(payload);
  };

  const handleRequest = async (
    method: string,
    reqUrl: string,
  ): Promise<{ status: number; body: Record<string, unknown> }> => {
    const url = new URL(reqUrl || "/", "http://127.0.0.1");

    if (method === "GET" && url.pathname === "/health") {
      return { status: 200, body: { ok: true, vault, recipient, chainId: CHAIN_ID } };
    }

    if (method === "GET" && url.pathname === "/data") {
      const invoiceParam = url.searchParams.get("invoice")?.trim();

      // Step 1: Unpaid request -> return 402 Payment Required with fresh invoice
      if (!invoiceParam) {
        const invoiceId = `inv-${Date.now()}-${randomBytes(4).toString("hex")}`;
        const invoice: PaidApiInvoice = {
          invoiceId,
          amount: priceQor,
          asset: "QOR",
          recipient,
          vault,
          chainId: CHAIN_ID,
          description: `Paid threat-intel feed (${invoiceId})`,
          createdAt: new Date().toISOString(),
        };
        invoices.set(invoiceId, invoice);
        return { status: 402, body: invoice as unknown as Record<string, unknown> };
      }

      // Reject reuse of an already-redeemed invoice
      if (redeemed.has(invoiceParam)) {
        return {
          status: 409,
          body: {
            error: "invoice_already_used",
            message: `Invoice ${invoiceParam} has already been redeemed. Request GET /data for a new invoice.`,
          },
        };
      }

      const invoice = invoices.get(invoiceParam);
      if (!invoice) {
        return {
          status: 404,
          body: {
            error: "invoice_not_found",
            message: `Unknown invoice ${invoiceParam}. Request GET /data first.`,
          },
        };
      }

      // Step 2: Verify on-chain AuthenticatedAgentIntentExecuted event from the vault
      try {
        const check = await verifyFn(invoice);
        if (!check.paid) {
          return {
            status: 402,
            body: {
              error: "payment_not_verified",
              reason: check.reason ?? "Payment not found on-chain",
              invoice,
            },
          };
        }

        redeemed.add(invoiceParam);
        return {
          status: 200,
          body: {
            paid: true,
            invoiceId: invoice.invoiceId,
            intentId: id(invoice.invoiceId),
            txHash: check.txHash,
            blockNumber: check.blockNumber,
            vault: invoice.vault,
            recipient: invoice.recipient,
            data: {
              feed: "qorechain-qday-threat-intel-v1",
              generatedAt: new Date().toISOString(),
              postQuantumReadinessScore: 99,
              signals: [
                { id: "sig-01", severity: "low", note: "0x0A01 ML-DSA-87 precompile healthy on qorechain-diana" },
                { id: "sig-02", severity: "low", note: "0x0A02 recipient firewall verified on settlement" },
              ],
            },
          },
        };
      } catch (err) {
        return {
          status: 502,
          body: {
            error: "verification_failed",
            message: err instanceof Error ? err.message : String(err),
          },
        };
      }
    }

    return { status: 404, body: { error: "not_found" } };
  };

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const out = await handleRequest(req.method || "GET", req.url || "/");
    return sendJson(res, out.status, out.body);
  });

  return { server, handleRequest, invoices, redeemed };
}

// Run standalone if executed directly
const isMain = process.argv[1] && (process.argv[1].endsWith("server.ts") || process.argv[1].endsWith("server.js"));
if (isMain) {
  const port = Number(process.env.PAID_API_PORT || 4020);
  const { server } = createPaidApiServer({ port });
  server.listen(port, "127.0.0.1", () => {
    console.log(`[agent-pays-api] Listening on http://127.0.0.1:${port}`);
    console.log(`[agent-pays-api] Vault: ${DEFAULT_VAULT}`);
    console.log(`[agent-pays-api] 0x0A02 Recipient: ${DEFAULT_RECIPIENT}`);
  });
}
