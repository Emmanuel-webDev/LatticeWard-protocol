import { Interface, JsonRpcProvider } from "ethers";
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
