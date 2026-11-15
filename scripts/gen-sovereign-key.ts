/**
 * Generates a dedicated ML-DSA-87 sovereign keypair for the vault.
 * The vault only stores keccak256(publicKey), so this key does NOT have to be the account's registered QoreX key.
 * Secret key is written to .sovereign-keys.json (gitignored, chmod 600). It is never printed.
 */
import { chmodSync, existsSync, writeFileSync } from "node:fs";
import { keccak256 } from "ethers";
import { generateSovereignKeypair } from "../packages/agent-mcp/src/pqc.js";

const file = ".sovereign-keys.json";
if (existsSync(file)) {
  console.error(`${file} already exists. Refusing to overwrite a sovereign key.`);
  process.exit(1);
}
const kp = generateSovereignKeypair();
writeFileSync(file, JSON.stringify({ publicKey: kp.publicKey, secretKey: kp.secretKey }, null, 2));
chmodSync(file, 0o600);
console.log("Sovereign ML-DSA-87 keypair written to", file);
console.log("sovereignKeyHash:", keccak256(kp.publicKey));
console.log("\nAdd to .env:");
console.log(`SOVEREIGN_PK_HEX=${kp.publicKey}`);
console.log("SOVEREIGN_SK_HEX=<copy secretKey from .sovereign-keys.json; keep it OFF the drill account / any server the bot can reach>");
console.log("\nFor forge deploy:  export LW_SOVEREIGN_PUBKEY=" + kp.publicKey.slice(0, 14) + "…(same value as SOVEREIGN_PK_HEX)");
