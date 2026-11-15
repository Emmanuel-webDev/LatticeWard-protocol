/**
 * Checks PQC key registration and EVM authorization window status for DEPLOYER, AGENT, and SUBMITTER:
 *   GET https://api-testnet.qore.host/qorechain/pqc/v1/account/{qorAddr}
 *   GET https://api-testnet.qore.host/qorechain/pqc/v1/evm_window/{qorAddr}
 * Never prints or logs private keys.
 */
import "dotenv/config";
import { Wallet, isAddress, formatUnits } from "ethers";
import { checkEvmWindow } from "../packages/agent-mcp/src/precompiles.js";
import { getProvider, getFusd } from "../packages/agent-mcp/src/config.js";

function deriveAddress(envVar: string): string | undefined {
  const raw = process.env[envVar]?.trim();
  if (!raw) return undefined;
  const k = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(k)) return undefined;
  return new Wallet(k).address;
}

const deployer = deriveAddress("DEPLOYER_PRIVATE_KEY");
const agent = deriveAddress("AGENT_PRIVATE_KEY");
const submitter = deriveAddress("SUBMITTER_PRIVATE_KEY") ?? deployer ?? agent;
const recipient = process.env.PQC_RECIPIENT?.trim();

const provider = getProvider();
const fusd = process.env.FUSD_ADDRESS ? getFusd(provider) : undefined;
const fusdDecimals = fusd ? Number(await fusd.decimals()) : 6;

const targets: { role: string; address: string | undefined }[] = [
  { role: "DEPLOYER", address: deployer },
  { role: "AGENT", address: agent },
  { role: "SUBMITTER", address: submitter },
];

if (recipient && isAddress(recipient)) {
  targets.push({ role: "PQC_RECIPIENT", address: recipient });
}

for (const extra of process.argv.slice(2)) {
  targets.push({ role: "CLI_ARG", address: extra });
}

for (const t of targets) {
  if (!t.address) {
    console.log(`[${t.role}] address not configured in .env`);
    continue;
  }
  try {
    const [st, qorRaw, fusdRaw] = await Promise.all([
      checkEvmWindow(t.address),
      provider.getBalance(t.address),
      fusd ? (fusd.balanceOf(t.address) as Promise<bigint>) : Promise.resolve(0n),
    ]);
    console.log(`[${t.role}] ${st.evmAddress} (${st.qorAddress})`);
    console.log(
      `  registered=${st.registered} | window: found=${st.found} live=${st.live} remaining_blocks=${st.remaining_blocks} remaining_txs=${st.remaining_txs} remaining_value=${st.remaining_value || "0"}`,
    );
    console.log(
      `  balances: QOR=${formatUnits(qorRaw, 18)} | fUSD(ERC-20)=${formatUnits(fusdRaw, fusdDecimals)} (raw=${fusdRaw.toString()})`,
    );
  } catch (e) {
    console.log(`[${t.role}] ${t.address}: query failed: ${(e as Error).message}`);
  }
}
