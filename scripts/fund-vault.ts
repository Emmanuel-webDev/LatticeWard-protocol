/**
 * Seeds LatticeWardVault with 1 QOR and (if available on DEPLOYER) up to 50 fUSD.
 * Never logs or prints private keys.
 */
import "dotenv/config";
import { Wallet, parseEther, parseUnits, formatEther, formatUnits } from "ethers";
import { getProvider, getFusd, env } from "../packages/agent-mcp/src/config.js";

const provider = getProvider();
const deployer = new Wallet(env("DEPLOYER_PRIVATE_KEY"), provider);
const vaultAddr = env("VAULT_ADDRESS");
const fusd = getFusd(deployer);
const fusdDecimals = Number(await fusd.decimals());

const [vaultQorBefore, vaultFusdBefore, deployerQorBefore, deployerFusdBefore] = await Promise.all([
  provider.getBalance(vaultAddr),
  fusd.balanceOf(vaultAddr) as Promise<bigint>,
  provider.getBalance(deployer.address),
  fusd.balanceOf(deployer.address) as Promise<bigint>,
]);

console.log(`Vault (${vaultAddr}) before: QOR=${formatEther(vaultQorBefore)} | fUSD=${formatUnits(vaultFusdBefore, fusdDecimals)}`);
console.log(`Deployer (${deployer.address}) before: QOR=${formatEther(deployerQorBefore)} | fUSD=${formatUnits(deployerFusdBefore, fusdDecimals)}`);

const targetQor = parseEther("1");
if (vaultQorBefore < targetQor) {
  const needed = targetQor - vaultQorBefore;
  const tx = await deployer.sendTransaction({
    to: vaultAddr,
    value: needed,
    gasLimit: 100_000n,
  });
  const receipt = await tx.wait();
  console.log(`Funded Vault with ${formatEther(needed)} QOR | txHash=${receipt?.hash ?? tx.hash}`);
}

const targetFusd = parseUnits("50", fusdDecimals);
if (vaultFusdBefore < targetFusd && deployerFusdBefore > 0n) {
  const needed = targetFusd - vaultFusdBefore;
  const amount = deployerFusdBefore >= needed ? needed : deployerFusdBefore;
  const tx = await fusd.transfer(vaultAddr, amount, { gasLimit: 150_000n });
  const receipt = await tx.wait();
  console.log(`Funded Vault with ${formatUnits(amount, fusdDecimals)} fUSD | txHash=${receipt?.hash ?? tx.hash}`);
} else if (vaultFusdBefore < targetFusd) {
  console.log(`Skipping fUSD transfer: Deployer ERC-20 fUSD balance is 0`);
}

const [vaultQorAfter, vaultFusdAfter] = await Promise.all([
  provider.getBalance(vaultAddr),
  fusd.balanceOf(vaultAddr) as Promise<bigint>,
]);
console.log(`Vault (${vaultAddr}) after: QOR=${formatEther(vaultQorAfter)} | fUSD=${formatUnits(vaultFusdAfter, fusdDecimals)}`);

