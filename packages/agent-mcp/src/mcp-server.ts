import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getBytes } from "ethers";
import { z } from "zod";
import { executeScopedSettlement } from "./agent.js";
import { env, explorerLink, getProvider, getVault } from "./config.js";
import { runQDayDrill } from "./drill.js";
import { pqcVerifyLocal } from "./pqc.js";
import { pqcKeyStatus } from "./precompiles.js";
import { ExecuteWithinScope } from "./schema.js";

const server = new McpServer({ name: "latticeward", version: "0.1.0" });
const text = (o: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(o, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2) }] });
const addr = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

server.tool(
  "latticeward_get_pqc_status",
  "Read the 0x0A02 pqcKeyStatus precompile for an address and the vault's live scoped policy.",
  { address: addr.optional().describe("Address to check; defaults to the vault's PQC_RECIPIENT") },
  async ({ address }) => {
    const provider = getProvider();
    const vault = getVault(provider);
    const who = address ?? env("PQC_RECIPIENT");
    const [status, frozen, expiry, nonce] = await Promise.all([
      pqcKeyStatus(provider, who),
      vault.frozen(),
      vault.windowExpiresAt(),
      vault.policyNonce(),
    ]);
    return text({ address: who, pqc: { registered: status.registered, algorithmId: status.algorithmId }, vault: { frozen, windowExpiresAt: expiry, policyNonce: nonce } });
  },
);

server.tool(
  "latticeward_simulate_intent",
  "Dry-run an agent intent through Zod guard, policy pre-check, 0x0A02 recipient check and simulateWithRiskScore. Never broadcasts.",
  ExecuteWithinScope.omit({ action: true }).shape,
  async (args) => text(await executeScopedSettlement({ action: "EXECUTE_WITHIN_SCOPE", ...args }, true)),
);

server.tool(
  "latticeward_execute_scoped_settlement",
  "Execute a settlement from the disposable agent key inside the vault's on-chain scoped window. Fail-closed at every stage.",
  ExecuteWithinScope.omit({ action: true }).shape,
  async (args) => text(await executeScopedSettlement({ action: "EXECUTE_WITHIN_SCOPE", ...args }, false)),
);

server.tool(
  "latticeward_run_qday_breach_drill",
  "Run the live Q-Day drill on qorechain-diana: valid payout, over-spend, non-PQC recipient, leaked-key policy hijack + drain, replay, ML-DSA-87 clawback and recovery.",
  {},
  async () => text(await runQDayDrill()),
);

server.tool(
  "latticeward_verify_mldsa_receipt",
  "Decode vault events from a tx hash; optionally verify an ML-DSA-87 signature locally over a digest.",
  {
    txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    publicKey: z.string().optional(),
    digest: z.string().optional(),
    signature: z.string().optional(),
  },
  async ({ txHash, publicKey, digest, signature }) => {
    const provider = getProvider();
    const vault = getVault(provider);
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt) return text({ error: "receipt not found" });
    const events = receipt.logs
      .filter((l) => l.address.toLowerCase() === env("VAULT_ADDRESS").toLowerCase())
      .map((l) => vault.interface.parseLog(l))
      .filter((p) => p !== null)
      .map((p) => ({ name: p!.name, args: p!.args.toObject?.() ?? p!.args }));
    const localSig = publicKey && digest && signature ? pqcVerifyLocal(publicKey, getBytes(digest), signature) : undefined;
    return text({ status: receipt.status, block: receipt.blockNumber, explorer: explorerLink(txHash), events, localMldsaVerification: localSig });
  },
);

await server.connect(new StdioServerTransport());
