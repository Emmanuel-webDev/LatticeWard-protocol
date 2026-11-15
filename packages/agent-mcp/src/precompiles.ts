import { bech32 } from "bech32";
import { Interface, JsonRpcProvider, getBytes } from "ethers";
import { PQC_KEY_STATUS_ADDRESS } from "./abi.js";

const statusIface = new Interface([
  "function pqcKeyStatus(address) view returns (bool registered,uint8 algorithmId,bytes pubkey)",
]);

export interface PqcStatus {
  registered: boolean;
  algorithmId: number;
  pubkey: string;
}

/** Direct eth_call to the 0x0A02 precompile. Throws if the chain returns something undecodable. */
export async function pqcKeyStatus(provider: JsonRpcProvider, address: string): Promise<PqcStatus> {
  const ret = await provider.call({
    to: PQC_KEY_STATUS_ADDRESS,
    data: statusIface.encodeFunctionData("pqcKeyStatus", [address]),
  });
  const d = statusIface.decodeFunctionResult("pqcKeyStatus", ret);
  return { registered: d[0] as boolean, algorithmId: Number(d[1]), pubkey: d[2] as string };
}

export const DEFAULT_QOR_REST_API = "https://api-testnet.qore.host";

export function evmToQorAddress(address: string): string {
  if (address.startsWith("qor1")) return address;
  return bech32.encode("qor", bech32.toWords(getBytes(address)));
}

export interface EvmWindowStatus {
  evmAddress: string;
  qorAddress: string;
  registered: boolean;
  found: boolean;
  live: boolean;
  remaining_blocks: string;
  remaining_txs: string;
  remaining_value: string;
}

/**
 * Queries QoreChain Native REST API for the sender's PQC registration and active EVM execution window:
 *   GET /qorechain/pqc/v1/account/{qorAddr}
 *   GET /qorechain/pqc/v1/evm_window/{qorAddr}
 */
export async function checkEvmWindow(
  address: string,
  apiBase = process.env.QOR_REST_API || DEFAULT_QOR_REST_API,
): Promise<EvmWindowStatus> {
  const base = apiBase.replace(/\/+$/, "");
  const qorAddress = evmToQorAddress(address);
  const [accRes, winRes] = await Promise.all([
    fetch(`${base}/qorechain/pqc/v1/account/${qorAddress}`),
    fetch(`${base}/qorechain/pqc/v1/evm_window/${qorAddress}`),
  ]);
  if (!accRes.ok) {
    throw new Error(`GET /qorechain/pqc/v1/account/${qorAddress} failed: HTTP ${accRes.status}`);
  }
  if (!winRes.ok) {
    throw new Error(`GET /qorechain/pqc/v1/evm_window/${qorAddress} failed: HTTP ${winRes.status}`);
  }
  const accJson = (await accRes.json()) as { found?: boolean };
  const winJson = (await winRes.json()) as {
    found?: boolean;
    live?: boolean;
    remaining_blocks?: string | number;
    remaining_txs?: string | number;
    remaining_value?: string;
  };
  return {
    evmAddress: address,
    qorAddress,
    registered: Boolean(accJson.found),
    found: Boolean(winJson.found),
    live: Boolean(winJson.live),
    remaining_blocks: String(winJson.remaining_blocks ?? "0"),
    remaining_txs: String(winJson.remaining_txs ?? "0"),
    remaining_value: String(winJson.remaining_value ?? ""),
  };
}
