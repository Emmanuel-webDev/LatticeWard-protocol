/**
 * Registers / updates QoreChain native x/abstractaccount spending rules, links the scoped
 * agent authenticator key with EIP-191 possession proof, and opens a scoped EVM window
 * restricted strictly to LatticeWardVault (0x9697a96058555b3A0C50b2338440C84B927caB29).
 *
 * Never prints or logs private keys or recovery phrases.
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DEFAULT_AA_RULE_CONFIG,
  LIVE_VAULT_ADDRESS,
  disableAbstractAccountRulesAndCloseWindow,
  loadHybridOwnerAccount,
  setupAbstractAccountAndRules,
} from "../src/abstractAccount.js";

function jsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

async function main() {
  const deployerMnemonic = process.env.DEPLOYER_MNEMONIC?.trim();
  const drillMnemonic = (process.env.DRILL_MNEMONIC || process.env.DRILL_PRIVATE_KEY || "").trim();
  const agentPk = process.env.AGENT_PRIVATE_KEY?.trim();

  if (!deployerMnemonic && !drillMnemonic) {
    throw new Error("Missing DEPLOYER_MNEMONIC (or DRILL_MNEMONIC) in .env");
  }
  if (!agentPk) {
    throw new Error("Missing AGENT_PRIVATE_KEY in .env");
  }

  const results: Record<string, unknown>[] = [];

  for (const [role, phrase, rc] of [
    ["DEPLOYER", deployerMnemonic, process.env.DEPLOYER_PQC_RECOVERY_CODE],
    ["DRILL_ACCOUNT", drillMnemonic, process.env.DRILL_PQC_RECOVERY_CODE],
  ] as const) {
    if (!phrase || phrase.split(/\s+/).length < 12) continue;
    const owner = await loadHybridOwnerAccount(phrase, rc);
    console.log(
      `[${role}] Configuring x/abstractaccount spending rules & authenticator on ${owner.cosmos} (${owner.evm})...`,
    );
    const res =
      role === "DEPLOYER"
        ? await setupAbstractAccountAndRules({
            ownerAccount: owner,
            agentPrivateKeyHex: agentPk,
            ruleConfig: {
              ...DEFAULT_AA_RULE_CONFIG,
              allowedEvmCalls: [LIVE_VAULT_ADDRESS],
              expiryUnix: Math.floor(Date.now() / 1000) + 30 * 86400, // 30-day TTL
            },
          })
        : await disableAbstractAccountRulesAndCloseWindow({
            ownerAccount: owner,
          });
    console.log(
      `[${role}] Committed in block ${res.height ?? 0} | txHash=${"txHash" in res ? res.txHash : res.transactionHash} | code=${res.code}`,
    );
    results.push({ role, ...res });
  }

  mkdirSync(resolve("audits"), { recursive: true });
  const proofPath = resolve("audits/onchain-proof.json");
  writeFileSync(
    proofPath,
    JSON.stringify(
      {
        network: "qorechain-diana",
        chainId: 9800,
        vaultAddress: LIVE_VAULT_ADDRESS,
        updatedAt: new Date().toISOString(),
        abstractAccountSetups: results,
      },
      jsonReplacer,
      2,
    ),
    "utf8",
  );
  console.log(`Saved x/abstractaccount setup proof to ${proofPath}`);
}

main().catch((err) => {
  console.error(`setup-abstract-account failed: ${(err as Error).message}`);
  process.exit(1);
});
