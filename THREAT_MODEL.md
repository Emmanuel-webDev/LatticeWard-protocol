# LatticeWard Threat Model (Testnet Prototype)

## Assets
Funds held inside `LatticeWardVault` (native QOR, ERC-20 fUSD); integrity of the scoped policy; the sovereign ML-DSA-87 key.
**Scope note:** Funds in your vault are protected by these rules; funds left outside the vault in a classical EOA remain classically exposed.

## Adversaries
1. **Prompt-injected agent**: LLM tricked into issuing malicious intents.
2. **Classical-key thief / Q-Day attacker**: holds the agent key (and any other secp256k1 key, including the owner's MetaMask EOA).
3. **Replayer / front-runner** of agent intents or sovereign signatures.
4. **Untrusted relayer / RPC**: a stateless relayer submitting user-signed sovereign transactions on the user's behalf.

## What the design guarantees (given correct precompiles)
| Attack | Result | Mechanism |
|---|---|---|
| Over-spend beyond per-tx cap | revert `ExceedsScopedMaxTxValue` | per-asset `maxTxValue` |
| Many small spends | stops at daily limit | `epochLimit` rolling 24h window (`epochDuration > 0`); day starts at first payment |
| Pay a quantum-vulnerable address | revert `RecipientNotQuantumSafe` | `0x0A02`, fail-closed on any precompile error |
| Leaked key changes policy / withdraws / rotates | revert `InvalidMLDSASignature` / `SovereignKeyMismatch` | `0x0A01`; no `ecrecover`, no `onlyOwner` |
| Replay of an agent intent | revert `IntentAlreadyUsed` | per-intent id |
| Replay of a sovereign signature | revert | digest includes monotonically increasing `policyNonce`, `block.chainid`, `address(this)` |
| Cross-vault signature replay | revert | `sovereignDigest` binds `address(this)` |
| Tampering with signed params | revert | digest commits to `keccak256(abi.encode(params))` |
| Compromised agent key persists | revoked in one tx | `triggerQDayEmergencyClawback` / `emergencyClawback` (ML-DSA-signed) |

## Phase 2 Additions: Custody, Factory, Relayer & Window Limits
- **Browser Key Custody (`BrowserKeySigner`):**
  - Random ML-DSA-87 keypair (`@noble/post-quantum`) encrypted with user passphrase via WebCrypto PBKDF2 (`310,000` iterations, SHA-256) + AES-256-GCM and stored in browser IndexedDB.
  - Mandatory `.lwkey.json` encrypted backup download and fingerprint confirmation before first vault creation.
  - **Honest risk:** If the user forgets their passphrase or clears browser data without their `.lwkey.json` backup, sovereign control over vaults tied to that key is permanently lost. If the browser host itself is compromised (XSS / malicious extension) while unlocked, the in-memory secret key is exposed.
- **`VaultFactory` Lack of Power:**
  - `VaultFactory.createVault(...)` deploys an isolated `LatticeWardVault` and records `owner => vaults` purely as an informational UI index.
  - `VaultFactory` has **zero** admin functions, zero `ecrecover`, zero `onlyOwner`, and cannot freeze, withdraw from, or modify any vault it deploys (verified by Foundry fuzz and invariant tests).
- **Stateless Relayer Trust Model (`packages/relayer`):**
  - The relayer only forwards **already user-signed** ML-DSA-87 sovereign calldata (`configurePolicy`, `setAssetLimit`, `sovereignWithdraw`, `triggerQDayEmergencyClawback`, `emergencyClawback`, `rotateSovereignKey`) to registered `VaultFactory` vaults.
  - It holds **no** user keys and **no** user funds. At worst, a compromised or offline relayer can censor/refuse to relay (DoS), in which case the UI falls back to **MetaMask** submission.
  - A relayer cannot forge or alter a sovereign action because `LatticeWardVault` verifies the ML-DSA-87 signature over `sovereignDigest` on-chain via `0x0A01`.
- **QoreChain EVM Window Limits:**
  - Every EVM transaction sender must have a registered ML-DSA-87 key and an open EVM authorization window (`1–17,280` blocks / ~6h max, `1–1,000` txs, `maxValue` in `uqor` including max fee).
  - Failed EVM transactions still consume a window slot.
  - An autonomous agent service must keep its own registered account and reopen its own EVM window on a schedule.

## What it does NOT guarantee
- **The agent key can still spend up to its caps.** Keep daily limits small.
- **`riskScoreBps` is agent-supplied.** On-chain it is advisory; `simulateWithRiskScore` is client-side and a stolen key bypasses it.
- **`pqcKeyStatus == true` means a key is registered, not that the recipient is trustworthy.**
- **Precompile trust.** Security rests on `0x0A01` being a correct FIPS 204 verifier on `qorechain-diana`.
- **Unaudited testnet prototype.** Not for mainnet.
