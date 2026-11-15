import { Contract, Wallet, ZeroAddress, hexlify, id, parseUnits, randomBytes } from "ethers";
import { env, explorerLink, getFusd, getProvider, getVault } from "./config.js";
import { checkEvmWindow } from "./precompiles.js";
import { sendSovereign } from "./sovereign.js";

export interface CheckResult {
  id: string;
  name: string;
  expected: string;
  observed: string;
  passed: boolean;
  skipped?: boolean;
  txHash?: string;
  explorer?: string;
}

async function revertName(vault: Contract, fn: string, args: unknown[]): Promise<string> {
  try {
    await vault.getFunction(fn).staticCall(...args);
    return "DID_NOT_REVERT";
  } catch (e) {
    const err = e as { revert?: { name?: string }; data?: string; shortMessage?: string };
    if (err.revert?.name) return err.revert.name;
    if (typeof err.data === "string" && err.data.length >= 10) {
      const p = vault.interface.parseError(err.data);
      if (p) return p.name;
    }
    return err.shortMessage ?? "UNKNOWN_REVERT";
  }
}

/** Sends the doomed tx with a fixed gas limit so it is MINED as a failed tx and has an explorer link. */
async function mineFailure(vault: Contract, fn: string, args: unknown[]): Promise<string | undefined> {
  try {
    const tx = await vault.getFunction(fn)(...args, { gasLimit: 3_000_000n });
    try {
      const r = await tx.wait();
      return r?.hash ?? tx.hash;
    } catch (e) {
      return (e as { receipt?: { hash?: string } }).receipt?.hash ?? tx.hash;
    }
  } catch {
    return undefined; // node refused to relay a tx it knows will fail; static result still counts
  }
}

async function expectRevert(
  idStr: string,
  name: string,
  expected: string,
  vault: Contract,
  fn: string,
  args: unknown[],
): Promise<CheckResult> {
  const observed = await revertName(vault, fn, args);
  const txHash = observed === "DID_NOT_REVERT" ? undefined : await mineFailure(vault, fn, args);
  return {
    id: idStr,
    name,
    expected: `revert ${expected}`,
    observed: observed === "DID_NOT_REVERT" ? "DID NOT REVERT" : `revert ${observed}`,
    passed: observed === expected,
    txHash,
    explorer: txHash ? explorerLink(txHash) : undefined,
  };
}

export async function runQDayDrill(): Promise<CheckResult[]> {
  const provider = getProvider();
  const agent = new Wallet(env("AGENT_PRIVATE_KEY"), provider);
  const leaked = new Wallet(process.env.LEAKED_PRIVATE_KEY || env("AGENT_PRIVATE_KEY"), provider);
  const submitter = new Wallet(
    process.env.SUBMITTER_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY || env("AGENT_PRIVATE_KEY"),
    provider,
  );
  const vaultAddr = env("VAULT_ADDRESS");
  const asAgent = getVault(agent);
  const asLeaked = getVault(leaked);
  const fusd = env("FUSD_ADDRESS");
  const fusdContract = getFusd(provider);
  const fusdDecimals = Number(await fusdContract.decimals());
  const vaultFusdBal: bigint = await fusdContract.balanceOf(vaultAddr);
  const vaultQorBal: bigint = await provider.getBalance(vaultAddr);
  const targetAsset = vaultFusdBal > 0n ? fusd : ZeroAddress;
  const targetDecimals = targetAsset === ZeroAddress ? 18 : fusdDecimals;
  const vaultAssetBal = targetAsset === ZeroAddress ? vaultQorBal : vaultFusdBal;
  const minPayout = parseUnits("0.01", targetDecimals);
  const pqcRecipient = env("PQC_RECIPIENT");
  const sovereignPk = env("SOVEREIGN_PK_HEX");
  const results: CheckResult[] = [];

  const lim = await asAgent.assetLimits(targetAsset);
  const maxTx: bigint = lim.maxTxValue;
  const mkIntent = (to: string, value: bigint) => ({
    intentId: hexlify(randomBytes(32)),
    target: targetAsset,
    recipient: to,
    value,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 600),
    riskScoreBps: 0n,
    rationaleHash: id("q-day drill"),
  });

  // Check agent EVM window before sending
  const agentWin = await checkEvmWindow(agent.address);
  if (!agentWin.registered || !agentWin.live) {
    results.push({
      id: "1",
      name: "Valid agent payout inside scoped window",
      expected: "success",
      observed: `window exhausted, reopen in QoreX (agent=${agent.address}, registered=${agentWin.registered}, found=${agentWin.found}, live=${agentWin.live}, remaining_blocks=${agentWin.remaining_blocks}, remaining_txs=${agentWin.remaining_txs})`,
      passed: false,
    });
    return results;
  }

  // 1. Valid payout inside the scoped window
  const happy = mkIntent(pqcRecipient, maxTx / 50n > 0n ? maxTx / 50n : minPayout);
  try {
    const tx = await asAgent.executeScopedAgentIntent(happy);
    const r = await tx.wait();
    const h = r?.hash ?? tx.hash;
    results.push({ id: "1", name: "Valid agent payout inside scoped window", expected: "success", observed: "success", passed: true, txHash: h, explorer: explorerLink(h) });
  } catch (e) {
    results.push({ id: "1", name: "Valid agent payout inside scoped window", expected: "success", observed: (e as Error).message.slice(0, 160), passed: false });
  }

  // 2. Prompt-injected over-spend
  results.push(
    await expectRevert("2", "Prompt-injected over-spend (10x per-tx cap)", "ExceedsScopedMaxTxValue", asAgent, "executeScopedAgentIntent", [mkIntent(pqcRecipient, maxTx * 10n)]),
  );

  // 3. Recipient without a registered ML-DSA-87 key (0x0A02 firewall)
  results.push(
    await expectRevert("3", "Payout to non-PQC burner address (0x0A02)", "RecipientNotQuantumSafe", asAgent, "executeScopedAgentIntent", [mkIntent(Wallet.createRandom().address, 1n)]),
  );

  // 4a/4b. Attacker holds the leaked classical key and tries admin / drain with no ML-DSA key
  const forged = hexlify(randomBytes(4627));
  results.push(
    await expectRevert("4a", "Leaked ECDSA key: hijack policy to 'unlimited' (0x0A01)", "InvalidMLDSASignature", asLeaked, "configurePolicy", [
      { agent: leaked.address, windowExpiresAt: 2n ** 200n, epochDuration: 1n, maxRiskScoreBps: 10000n, requireRecipientPqc: false, frozen: false },
      sovereignPk,
      forged,
    ]),
  );
  results.push(
    await expectRevert("4b", "Leaked ECDSA key: sovereignWithdraw entire vault (0x0A01)", "InvalidMLDSASignature", asLeaked, "sovereignWithdraw", [
      { asset: targetAsset, to: leaked.address, amount: vaultAssetBal },
      sovereignPk,
      forged,
    ]),
  );

  // 5. Replay of the already-executed intent
  results.push(await expectRevert("5", "Replay of an executed intent", "IntentAlreadyUsed", asAgent, "executeScopedAgentIntent", [happy]));

  // 6. Sovereign ML-DSA-87 emergency clawback + recovery
  if (!process.env.SOVEREIGN_SK_HEX) {
    results.push({ id: "6", name: "ML-DSA-87 emergency freeze + recovery", expected: "success", observed: "skipped (SOVEREIGN_SK_HEX not set)", passed: false, skipped: true });
    return results;
  }
  const subWin = await checkEvmWindow(submitter.address);
  if (!subWin.registered || !subWin.live) {
    results.push({
      id: "6",
      name: "ML-DSA-87 emergency freeze + recovery",
      expected: "success",
      observed: `window exhausted, reopen in QoreX (submitter=${submitter.address}, registered=${subWin.registered}, found=${subWin.found}, live=${subWin.live}, remaining_blocks=${subWin.remaining_blocks}, remaining_txs=${subWin.remaining_txs})`,
      passed: false,
    });
    return results;
  }
  try {
    const vault = getVault(submitter);
    const orig = {
      agent: (await vault.agentKey()) as string,
      windowExpiresAt: (await vault.windowExpiresAt()) as bigint,
      epochDuration: (await vault.epochDuration()) as bigint,
      maxRiskScoreBps: (await vault.maxRiskScoreBps()) as bigint,
      requireRecipientPqc: (await vault.requireRecipientPqc()) as boolean,
    };
    const fresh = Wallet.createRandom().address;
    const c = await sendSovereign(vault, submitter, "emergencyClawback", { newAgent: fresh, rescue: ZeroAddress, assets: [] });
    const frozen = (await vault.frozen()) as boolean;
    const rotated = ((await vault.agentKey()) as string).toLowerCase() === fresh.toLowerCase();
    const oldAgentBlocked = (await revertName(asAgent, "executeScopedAgentIntent", [mkIntent(pqcRecipient, 1n)])) === "NotAgent";
    results.push({
      id: "6a", name: "ML-DSA-87 emergency clawback: revoke compromised key + freeze",
      expected: "frozen, key rotated, old key blocked", observed: `frozen=${frozen} rotated=${rotated} oldKeyBlocked=${oldAgentBlocked}`,
      passed: frozen && rotated && oldAgentBlocked, txHash: c.txHash, explorer: explorerLink(c.txHash),
    });
    const r = await sendSovereign(vault, submitter, "configurePolicy", { ...orig, frozen: false });
    const back = !((await vault.frozen()) as boolean);
    results.push({
      id: "6b", name: "ML-DSA-87 recovery: unfreeze + restore agent",
      expected: "unfrozen", observed: `frozen=${!back}`, passed: back, txHash: r.txHash, explorer: explorerLink(r.txHash),
    });
  } catch (e) {
    results.push({ id: "6", name: "ML-DSA-87 emergency freeze + recovery", expected: "success", observed: (e as Error).message.slice(0, 200), passed: false });
  }
  return results;
}

