# LatticeWard

**Post-quantum spend-governance & Q-Day immunity engine for autonomous AI agents on QoreChain.**

Built for the QoreChain Developer Fest "Build Before Q-Day" (Post-Quantum AI Agents track). Target network: `qorechain-diana` (EVM chain id 9800).

## The idea

AI agents need hot `secp256k1` keys to act without human popups. Today a prompt injection leaks that key; on Q-Day Shor's algorithm derives it from the public key. LatticeWard assumes **every classical key will be compromised** and splits authority:

| Plane | Key | Can do | Enforced by |
|---|---|---|---|
| Execution | disposable `secp256k1` agent key | pay out inside a scoped window: per-asset max/tx, rolling epoch cap, expiry, asset allowlist, replay-protected intents, recipient must pass `pqcKeyStatus` (`0x0A02`) | `LatticeWardVault.executeScopedAgentIntent` |
| Sovereign | ML-DSA-87 (FIPS 204) | change policy, raise limits, withdraw, rotate keys, emergency freeze/clawback | `pqcVerify` (`0x0A01`) over a digest bound to chainid + vault + nonce + params |

The vault has **no `ecrecover` and no `onlyOwner`**. `msg.sender` carries no admin authority, so a leaked classical key cannot administer anything.

Agent-side defence in depth: fail-closed Zod intent grammar -> client policy pre-check -> `0x0A02` recipient check -> `simulateWithRiskScore` pre-flight -> broadcast. Exposed as an MCP server (5 tools).

## Repo layout

```
contracts/            LatticeWardVault.sol, QorePQC.sol (fail-closed precompile wrappers), test mocks + Foundry tests
script/Deploy.s.sol   forge deploy script
packages/agent-mcp/   schema.ts (Zod), preflight.ts, agent.ts, drill.ts, sovereign.ts, mcp-server.ts
scripts/              probe-precompiles, gen-sovereign-key, sovereign-cli, verify-qday
docs: THREAT_MODEL.md, AI_USAGE.md, DRILL_RUNBOOK.md, audits/
```

## Quickstart

```bash
npm install
forge install foundry-rs/forge-std --no-commit
forge test -vv                    # contract tests (mock precompiles)
cp .env.example .env              # fill in RPC + keys (testnet only!)
npm run probe                     # Sprint-1: confirm real 0x0A01 / 0x0A02 ABI on qorechain-diana
npm run gen:sovereign             # dedicated ML-DSA-87 sovereign keypair
# deploy (see DRILL_RUNBOOK.md for env vars), then:
npm run verify:qday               # live drill: valid payout, over-spend, non-PQC recipient,
                                  # leaked-key hijack + drain, replay, ML-DSA clawback + recovery
npm run mcp                       # MCP server over stdio (Claude Desktop / Cursor)
```

## Status

Compiled, tested, deployed, and verified live on `qorechain-diana` (Chain ID `9800`):

- **Foundry tests (`forge test -vv`):** 32/32 passing (30 unit/fuzz/hardening tests across `LatticeWard.t.sol` and `LatticeWardVault.t.sol` + 2 invariant suites at 512 runs / 256,000 calls).
- **TypeScript (`npm run typecheck`):** 0 errors.
- **Precompile ABI probe (`npm run probe`):** Confirmed live `0x0A02` (`pqcKeyStatus`) and `0x0A01` (`pqcVerify`) on `qorechain-diana`. `0x0A01` uses `(bytes publicKey, bytes signature, bytes message)` argument order (`QorePQC.sol`, `IQorePrecompiles.sol`, and `MockPQC.sol` updated accordingly).
- **AI Risk Pre-flight (`packages/agent-mcp/src/preflight.ts`):** Wired to `@qorechain/sdk`'s `simulateWithRiskScore` (`@qorechain/evm`), strictly fail-closed.
- **Live Q-Day Breach Drill (`npm run verify:qday`):** **8/8 checks PASS** on `qorechain-diana` (see [`qday-report.json`](./qday-report.json) and transaction links below).
- **Static analysis (`@qorechain/qorescan`):** Saved to [`audits/qorescan_stage1.json`](./audits/qorescan_stage1.json). QCAI portal audit reports (`QCAI_STAGE_1_INITIAL.md` / `QCAI_STAGE_2_FINAL.md`) are not yet generated.
- **Out of scope for v0.1:** Web Command Center UI (`packages/web`) and DCA via an allowlisted router are not implemented (v0.1 = scoped payouts + sovereign ML-DSA-87 control plane + MCP server).

## Deployed addresses (`qorechain-diana`, Chain ID `9800`)

- **LatticeWardVault:** `0x9697a96058555b3A0C50b2338440C84B927caB29`
  - Deploy tx: [`0xce42a4cd136064c000170a7f2d03193b1fe1f3e02e60a2094ffeb10dde6c7e84`](https://explore.qore.network/tx/0xce42a4cd136064c000170a7f2d03193b1fe1f3e02e60a2094ffeb10dde6c7e84)
  - Vault funding tx (`1.0 QOR`): [`0x62106213413a97a740c39235390fcfbcf2e3e3502dfe545c96a4b9c8e02ee4c5`](https://explore.qore.network/tx/0x62106213413a97a740c39235390fcfbcf2e3e3502dfe545c96a4b9c8e02ee4c5)
- **Sovereign ML-DSA-87 Key Hash (`sovereignKeyHash`):** `0xfc4c13af8aac8233f2566485d7ca4ba7ef53db50c07aebad3630cf2058178d23`
- **fUSD (FestUSD, 6 decimals):** `0x97143B771D34ddb9130b807b135Ae675A5a963CA`
- **Deployer / Submitter:** `0x480261F742b3CfA5f1659da6FAd089BDB6CFD0B3` (`qor1fqpxra6zk086tut9nkn045yfhkmvl59nlnegea`)
- **Scoped Agent (disposable hot key):** `0xc40352672Ac28fD9DE498AbE2c3CedF9367FDE04` (`qor1csp4yee2c28anhjf32lzc08dlym8lhsydmhj6l`)
- **PQC Recipient (`0x0A02` registered):** `0xD6891e4Ef67be07b5DE9703Dcc4cf36eF4D15aae` (`qor166y3unhk00s8kh0fwq7ucn8ndm6dzk4w0gq3kx`)

### Live Q-Day Breach Drill Transactions (`8/8 PASS`)

| Check | Scenario | Expected / Observed | Explorer Link |
|---|---|---|---|
| **1** | Valid agent payout inside scoped window | `success` | [`0xf176d242...8e69bfcc`](https://explore.qore.network/tx/0xf176d24256d812af43b035a4eb4655156a3aadddcbd7f0332a9e170d8e69bfcc) |
| **2** | Prompt-injected over-spend (10x per-tx cap) | `revert ExceedsScopedMaxTxValue` | [`0xc1c7521c...8ab5d654`](https://explore.qore.network/tx/0xc1c7521c78a041ff91a0cdda0347cafb1568b1606f34d40a287b28a68ab5d654) |
| **3** | Payout to non-PQC burner address (`0x0A02`) | `revert RecipientNotQuantumSafe` | [`0xaee3adac...59e8bf33`](https://explore.qore.network/tx/0xaee3adacd0ae5f5e530cb39552f3a820ef397318ae6af040585e546959e8bf33) |
| **4a** | Leaked ECDSA key: hijack policy to `'unlimited'` (`0x0A01`) | `revert InvalidMLDSASignature` | [`0xc5ea3799...56f64a52`](https://explore.qore.network/tx/0xc5ea37991d81a18b2af9b25ab59247df9abd3d5a33bab6d923ccbccc56f64a52) |
| **4b** | Leaked ECDSA key: `sovereignWithdraw` entire vault (`0x0A01`) | `revert InvalidMLDSASignature` | [`0xd475f3fc...7f368f6b`](https://explore.qore.network/tx/0xd475f3fce24190e0bd949e90058a98f7b7c4878300bd8bc23f5791d27f368f6b) |
| **5** | Replay of an executed intent | `revert IntentAlreadyUsed` | `staticCall verified (revert IntentAlreadyUsed)` |
| **6a** | ML-DSA-87 emergency clawback (`triggerQDayEmergencyClawback`): revoke compromised key + freeze | `frozen=true rotated=true oldKeyBlocked=true` | [`0x16dac299...b5edf9e0`](https://explore.qore.network/tx/0x16dac29907d06ffbd1567392e0ab9c98e1d4f6661afa537a0470ed56b5edf9e0) |
| **6b** | ML-DSA-87 recovery: unfreeze + restore agent | `frozen=false` | [`0x8c53a3db...b74ea7da`](https://explore.qore.network/tx/0x8c53a3db12e00cc51ed291e188c64b0f2b00d1a5f772bee757caa32fb74ea7da) |

## License

MIT
