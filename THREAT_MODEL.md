# LatticeWard Threat Model (v0.1, draft)

## Assets
Funds held by `LatticeWardVault` (native QOR, fUSD); integrity of the scoped policy; the sovereign ML-DSA-87 key.

## Adversaries
1. **Prompt-injected agent**: LLM tricked into issuing malicious intents.
2. **Classical-key thief / Q-Day attacker**: has the agent key (and any other secp256k1 key, including the owner's EOA).
3. **Replayer / front-runner** of agent intents.

## What the design guarantees (given correct precompiles)
| Attack | Result | Mechanism |
|---|---|---|
| Over-spend beyond per-tx cap | revert `ExceedsScopedMaxTxValue` | per-asset `maxTxValue` |
| Many small spends | stops at epoch cap | `epochLimit` rolling window; `epochDuration` must be > 0 |
| Pay a quantum-vulnerable address | revert `RecipientNotQuantumSafe` | `0x0A02`, fail-closed on any precompile error |
| Leaked key changes policy / withdraws / rotates | revert `InvalidMLDSASignature` / `SovereignKeyMismatch` | `0x0A01`; no `ecrecover`, no `onlyOwner` |
| Replay of an agent intent | revert `IntentAlreadyUsed` | per-intent id |
| Replay of a sovereign signature | revert | digest includes monotonically increasing `policyNonce`, chainid, vault address |
| Tampering with signed params | revert | digest commits to `keccak256(abi.encode(params))` |
| Compromised agent key persists | revoked in one tx | `emergencyClawback` (ML-DSA-signed) |

## What it does NOT guarantee (be honest in the demo)
- **The agent key can still spend up to its caps.** The design bounds loss; it does not make it zero. Keep caps small.
- **`riskScoreBps` is agent-supplied.** On-chain it is a recorded, advisory ceiling. The real `simulateWithRiskScore` gate is client-side and a stolen key bypasses it.
- **Sovereign key compromise is catastrophic.** Store the ML-DSA-87 secret key offline; it must never live on the agent host.
- **`pqcKeyStatus == true` means a key is registered, not that the recipient is trustworthy.**
- **Any funds held directly in a classical EOA remain classically exposed**, including a drill account's own balance. Keep working funds in the vault.
- **Precompile trust.** Security rests on `0x0A01` being a correct FIPS 204 verifier on `qorechain-diana`.
- v0.1 agent authentication is `msg.sender == agentKey`. A signed-envelope relayer model (ecrecover in the agent lane only) is a planned extension.
- Liveness: a frozen vault needs the sovereign key to resume.
- Unaudited. Not for mainnet.
