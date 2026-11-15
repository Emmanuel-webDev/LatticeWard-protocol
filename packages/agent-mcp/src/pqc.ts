import { ml_dsa87 } from "@noble/post-quantum/ml-dsa";
import { getBytes, hexlify, randomBytes } from "ethers";

export const ML_DSA_87_PK_LEN = 2592;
export const ML_DSA_87_SK_LEN = 4896;
export const ML_DSA_87_SIG_LEN = 4627;

export function generateSovereignKeypair(): { publicKey: string; secretKey: string } {
  const kp = ml_dsa87.keygen(randomBytes(32));
  return { publicKey: hexlify(kp.publicKey), secretKey: hexlify(kp.secretKey) };
}

// @noble/post-quantum has changed argument order between releases. We pin 0.4.1, but this wrapper
// also tries the alternative order and round-trip verifies, so a version drift fails loudly, not silently.
type AnyFn = (...a: Uint8Array[]) => unknown;

export function pqcVerifyLocal(pkHex: string, message: Uint8Array, sigHex: string): boolean {
  const pk = getBytes(pkHex);
  const sig = getBytes(sigHex);
  if (pk.length !== ML_DSA_87_PK_LEN || sig.length !== ML_DSA_87_SIG_LEN) return false;
  const v = ml_dsa87.verify as unknown as AnyFn;
  for (const args of [[pk, message, sig], [sig, message, pk]]) {
    try {
      if (v(...args) === true) return true;
    } catch {
      /* try next order */
    }
  }
  return false;
}

export function pqcSign(skHex: string, pkHex: string, message: Uint8Array): string {
  const sk = getBytes(skHex);
  if (sk.length !== ML_DSA_87_SK_LEN) throw new Error(`ML-DSA-87 secret key must be ${ML_DSA_87_SK_LEN} bytes`);
  const sign = ml_dsa87.sign as unknown as AnyFn;
  for (const args of [[sk, message], [message, sk]]) {
    try {
      const out = sign(...args) as Uint8Array;
      const hex = hexlify(out);
      if (out.length === ML_DSA_87_SIG_LEN && pqcVerifyLocal(pkHex, message, hex)) return hex;
    } catch {
      /* try next order */
    }
  }
  throw new Error("ML-DSA-87 signing failed round-trip verification (check @noble/post-quantum version)");
}
