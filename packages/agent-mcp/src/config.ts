import "dotenv/config";
import { Contract, JsonRpcProvider, Wallet } from "ethers";
import { ERC20_ABI, VAULT_ABI } from "./abi.js";

export function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Missing required env var ${name} (see .env.example)`);
  return v;
}

export function getProvider(): JsonRpcProvider {
  const chainId = Number(process.env.QOR_CHAIN_ID ?? 9800);
  return new JsonRpcProvider(env("QOR_EVM_RPC"), { chainId, name: "qorechain-diana" }, { staticNetwork: true } as never);
}

export function getVault(runner: Wallet | JsonRpcProvider): Contract {
  return new Contract(env("VAULT_ADDRESS"), VAULT_ABI, runner);
}

export function getFusd(runner: Wallet | JsonRpcProvider): Contract {
  return new Contract(env("FUSD_ADDRESS"), ERC20_ABI, runner);
}

export function explorerLink(hash: string): string | undefined {
  const t = process.env.EXPLORER_TX_URL;
  return t ? t.replace("{hash}", hash) : undefined;
}
