/**
 * ML-DSA-87 sovereign operations, signed locally, submitted by any funded account.
 *   npm run sovereign -- freeze
 *   npm run sovereign -- unfreeze
 *   npm run sovereign -- rotate-agent 0xNewAgent
 *   npm run sovereign -- withdraw fUSD|QOR 0xTo 1.5
 */
import { Wallet, ZeroAddress, parseUnits } from "ethers";
import { env, explorerLink, getProvider, getVault } from "../packages/agent-mcp/src/config.js";
import { sendSovereign } from "../packages/agent-mcp/src/sovereign.js";

const [cmd, a, b, c] = process.argv.slice(2);
const provider = getProvider();
const submitter = new Wallet(process.env.SUBMITTER_PRIVATE_KEY || env("DEPLOYER_PRIVATE_KEY"), provider);
const vault = getVault(submitter);

async function policy(over: Record<string, unknown>) {
  return {
    agent: (await vault.agentKey()) as string,
    windowExpiresAt: (await vault.windowExpiresAt()) as bigint,
    epochDuration: (await vault.epochDuration()) as bigint,
    maxRiskScoreBps: (await vault.maxRiskScoreBps()) as bigint,
    requireRecipientPqc: (await vault.requireRecipientPqc()) as boolean,
    frozen: (await vault.frozen()) as boolean,
    ...over,
  };
}

let res: { txHash: string } | undefined;
switch (cmd) {
  case "freeze":
    res = await sendSovereign(vault, submitter, "emergencyClawback", { newAgent: await vault.agentKey(), rescue: ZeroAddress, assets: [] });
    break;
  case "unfreeze":
    res = await sendSovereign(vault, submitter, "configurePolicy", await policy({ frozen: false }));
    break;
  case "rotate-agent":
    res = await sendSovereign(vault, submitter, "configurePolicy", await policy({ agent: a }));
    break;
  case "withdraw":
    res = await sendSovereign(vault, submitter, "sovereignWithdraw", {
      asset: a === "QOR" ? ZeroAddress : env("FUSD_ADDRESS"),
      to: b,
      amount: parseUnits(c, 18),
    });
    break;
  default:
    console.error("usage: sovereign -- freeze | unfreeze | rotate-agent <addr> | withdraw <fUSD|QOR> <to> <amount>");
    process.exit(2);
}
console.log("tx:", explorerLink(res.txHash) ?? res.txHash);
