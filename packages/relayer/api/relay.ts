import type { IncomingMessage, ServerResponse } from "node:http";
import { Contract, Interface, JsonRpcProvider, Wallet, isAddress } from "ethers";

const RPC_URL = process.env.QOR_EVM_RPC || "https://evm-testnet.qore.host";
const CHAIN_ID = Number(process.env.QOR_CHAIN_ID || 9800);
const FACTORY_ADDRESS = process.env.FACTORY_ADDRESS || "0xAEdE5a3B09c9BDC749297C39826C6DDdaF311C5c";

const ALLOWED_SELECTORS = new Set(
  new Interface([
    "function configurePolicy((address,uint256,uint256,uint256,bool,bool),bytes,bytes)",
    "function setAssetLimit((address,bool,uint256,uint256),bytes,bytes)",
    "function sovereignWithdraw((address,address,uint256),bytes,bytes)",
    "function triggerQDayEmergencyClawback((address,address,address[]),bytes,bytes)",
    "function emergencyClawback((address,address,address[]),bytes,bytes)",
    "function rotateSovereignKey(bytes32,bytes,bytes)",
  ]).fragments.map((f) => Interface.getAbiCoder() && f.format("sighash")),
);

// Compute 4-byte selectors cleanly
const SOVEREIGN_IFACE = new Interface([
  "function configurePolicy((address,uint256,uint256,uint256,bool,bool),bytes,bytes)",
  "function setAssetLimit((address,bool,uint256,uint256),bytes,bytes)",
  "function sovereignWithdraw((address,address,uint256),bytes,bytes)",
  "function triggerQDayEmergencyClawback((address,address,address[]),bytes,bytes)",
  "function emergencyClawback((address,address,address[]),bytes,bytes)",
  "function rotateSovereignKey(bytes32,bytes,bytes)",
]);

const ALLOWED_4BYTE = new Set(
  [
    "configurePolicy",
    "setAssetLimit",
    "sovereignWithdraw",
    "triggerQDayEmergencyClawback",
    "emergencyClawback",
    "rotateSovereignKey",
  ].map((name) => SOVEREIGN_IFACE.getFunction(name)!.selector.toLowerCase()),
);
void ALLOWED_SELECTORS;

const rateBucket = new Map<string, number[]>();
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQ = 10;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const hits = (rateBucket.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (hits.length >= RATE_MAX_REQ) {
    rateBucket.set(ip, hits);
    return true;
  }
  hits.push(now);
  rateBucket.set(ip, hits);
  return false;
}

function setCors(res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function json(res: ServerResponse, status: number, body: unknown) {
  setCors(res);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

export default async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  if (req.method === "OPTIONS") {
    setCors(res);
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== "POST") {
    return json(res, 405, { error: "Method not allowed" });
  }

  const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim();
  if (isRateLimited(ip)) {
    return json(res, 429, { error: "Rate limit exceeded. Try again in a minute or submit via MetaMask." });
  }

  const relayerPk = process.env.RELAYER_PRIVATE_KEY?.trim();
  if (!relayerPk) {
    return json(res, 503, { error: "Relayer key not configured on server." });
  }

  const body = (typeof req.body === "string" ? JSON.parse(req.body) : req.body) as { to?: string; data?: string } | undefined;
  const to = body?.to?.trim() ?? "";
  const data = body?.data?.trim() ?? "";

  if (!isAddress(to) || !/^0x[0-9a-fA-F]{8,}$/.test(data)) {
    return json(res, 400, { error: "Invalid to address or calldata." });
  }

  const selector = data.slice(0, 10).toLowerCase();
  if (!ALLOWED_4BYTE.has(selector)) {
    return json(res, 403, { error: "Only ML-DSA-87 sovereign vault calls may be relayed." });
  }

  try {
    const provider = new JsonRpcProvider(RPC_URL, { chainId: CHAIN_ID, name: "qorechain-diana" }, { staticNetwork: true } as never);
    const factory = new Contract(FACTORY_ADDRESS, ["function isVault(address) view returns (bool)"], provider);
    const knownVault = (await factory.isVault(to)) as boolean;
    if (!knownVault) {
      return json(res, 403, { error: "Target address is not a registered VaultFactory vault." });
    }

    const wallet = new Wallet(relayerPk.startsWith("0x") ? relayerPk : `0x${relayerPk}`, provider);
    // Dry-run first so we don't waste an EVM window slot on an invalid ML-DSA signature
    await provider.call({ from: wallet.address, to, data });

    const tx = await wallet.sendTransaction({ to, data, gasLimit: 500_000n });
    const receipt = await tx.wait();
    return json(res, 200, { txHash: tx.hash, blockNumber: receipt?.blockNumber ?? null });
  } catch (err) {
    return json(res, 502, {
      error: err instanceof Error ? err.message : "Relayer broadcast failed. Submit via MetaMask instead.",
    });
  }
}
