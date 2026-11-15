/**
 * Sprint-1 probe: discovers the REAL ABI of the QoreChain PQC precompiles before we trust our assumptions.
 *   npm run probe [-- 0xAddressToCheck]
 * 1) eth_call 0x0A02 pqcKeyStatus(address)
 * 2) generate a local ML-DSA-87 keypair + signature, then eth_call 0x0A01 pqcVerify with every argument order,
 *    plus a corrupted-signature negative control. Prints which order returns true.
 */
import { Interface, getBytes, hexlify, id, randomBytes } from "ethers";
import { PQC_VERIFY_ADDRESS } from "../packages/agent-mcp/src/abi.js";
import { getProvider } from "../packages/agent-mcp/src/config.js";
import { generateSovereignKeypair, pqcSign } from "../packages/agent-mcp/src/pqc.js";
import { pqcKeyStatus } from "../packages/agent-mcp/src/precompiles.js";

const provider = getProvider();
const who = process.argv[2] ?? "0x0000000000000000000000000000000000000001";

console.log("== 0x0A02 pqcKeyStatus ==");
try {
  console.log(await pqcKeyStatus(provider, who));
} catch (e) {
  console.log("decode failed (ABI assumption wrong?):", (e as Error).message);
}

console.log("\n== 0x0A01 pqcVerify ==");
const kp = generateSovereignKeypair();
const msg = getBytes(id("latticeward-probe"));
const sig = pqcSign(kp.secretKey, kp.publicKey, msg);
const bad = hexlify(randomBytes(4627));
const iface = new Interface(["function pqcVerify(bytes,bytes,bytes) view returns (bool)"]);
const named = { pk: kp.publicKey, msg: hexlify(msg), sig };
const orders: [string, string, string][] = [["pk", "msg", "sig"], ["pk", "sig", "msg"], ["msg", "pk", "sig"], ["msg", "sig", "pk"], ["sig", "pk", "msg"], ["sig", "msg", "pk"]];

for (const o of orders) {
  const args = o.map((k) => named[k as keyof typeof named]);
  const negArgs = o.map((k) => (k === "sig" ? bad : named[k as keyof typeof named]));
  try {
    const ok = iface.decodeFunctionResult("pqcVerify", await provider.call({ to: PQC_VERIFY_ADDRESS, data: iface.encodeFunctionData("pqcVerify", args) }))[0];
    const neg = iface.decodeFunctionResult("pqcVerify", await provider.call({ to: PQC_VERIFY_ADDRESS, data: iface.encodeFunctionData("pqcVerify", negArgs) }))[0];
    console.log(`(${o.join(",")}): valid=${ok} corrupted=${neg}${ok && !neg ? "   <== USE THIS ORDER" : ""}`);
  } catch (e) {
    console.log(`(${o.join(",")}): call failed: ${(e as Error).message.slice(0, 120)}`);
  }
}
console.log("\nIf no order prints USE THIS ORDER, the precompile uses a different calldata layout. Paste this output back and adjust QorePQC.verify().");
