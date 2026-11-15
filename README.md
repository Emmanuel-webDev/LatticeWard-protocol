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

- **Foundry tests (`forge test -vv`):** 29/29 passing (27 unit/fuzz tests + 2 invariant suites at 512 runs / 256,000 calls).
- **TypeScript (`npm run typecheck`):** 0 errors.
- **Precompile ABI probe (`npm run probe`):** Confirmed live `0x0A02` (`pqcKeyStatus`) and `0x0A01` (`pqcVerify`) on `qorechain-diana`. `0x0A01` uses `(bytes publicKey, bytes signature, bytes message)` argument order (`QorePQC.sol`, `IQorePrecompiles.sol`, and `MockPQC.sol` updated accordingly).
- **AI Risk Pre-flight (`packages/agent-mcp/src/preflight.ts`):** Wired to `@qorechain/sdk`'s `simulateWithRiskScore` (`@qorechain/evm`), strictly fail-closed.
- **Live Q-Day Breach Drill (`npm run verify:qday`):** **8/8 checks PASS** on `qorechain-diana` (see [`qday-report.json`](./qday-report.json) and transaction links below).
- **Static analysis (`@qorechain/qorescan`):** Saved to [`audits/qorescan_stage1.json`](./audits/qorescan_stage1.json). QCAI portal audit reports (`QCAI_STAGE_1_INITIAL.md` / `QCAI_STAGE_2_FINAL.md`) are not yet generated.
- **Out of scope for v0.1:** Web Command Center UI (`packages/web`) and DCA via an allowlisted router are not implemented (v0.1 = scoped payouts + sovereign ML-DSA-87 control plane + MCP server).

## Deployed addresses (`qorechain-diana`, Chain ID `9800`)

- **LatticeWardVault:** `0x8F74F67aDf6aD1B66bCFA0754635Dd4948E9fC7d`
  - Deploy tx: [`0x47a5809b0f8233d83005c367a47be8955902f0026e56547a88fd0e7a0e72a5ac`](https://explore.qore.network/tx/0x47a5809b0f8233d83005c367a47be8955902f0026e56547a88fd0e7a0e72a5ac)
  - Vault funding tx (`1.0 QOR`): [`0xa673d13357ed20ea4619c4c49ad1420ed1c8cec0f1ad39189cbd895858118d3c`](https://explore.qore.network/tx/0xa673d13357ed20ea4619c4c49ad1420ed1c8cec0f1ad39189cbd895858118d3c)
- **Sovereign ML-DSA-87 Key Hash (`sovereignKeyHash`):** `0xfc4c13af8aac8233f2566485d7ca4ba7ef53db50c07aebad3630cf2058178d23`
- **fUSD (FestUSD, 6 decimals):** `0x97143B771D34ddb9130b807b135Ae675A5a963CA`
- **Deployer / Submitter:** `0x480261F742b3CfA5f1659da6FAd089BDB6CFD0B3` (`qor1fqpxra6zk086tut9nkn045yfhkmvl59nlnegea`)
- **Scoped Agent (disposable hot key):** `0xc40352672Ac28fD9DE498AbE2c3CedF9367FDE04` (`qor1csp4yee2c28anhjf32lzc08dlym8lhsydmhj6l`)
- **PQC Recipient (`0x0A02` registered):** `0xD6891e4Ef67be07b5DE9703Dcc4cf36eF4D15aae` (`qor166y3unhk00s8kh0fwq7ucn8ndm6dzk4w0gq3kx`)

### Live Q-Day Breach Drill Transactions (`8/8 PASS`)

| Check | Scenario | Expected / Observed | Explorer Link |
|---|---|---|---|
| **1** | Valid agent payout inside scoped window | `success` | [`0x578a820e...fe0d68f4`](https://explore.qore.network/tx/0x578a820e9f3646fcfdf5d992c877efa20d7d31d576ddd621fbb69aa8fe0d68f4) |
| **2** | Prompt-injected over-spend (10x per-tx cap) | `revert ExceedsScopedMaxTxValue` | [`0xf8e5cd90...8be2cc08`](https://explore.qore.network/tx/0xf8e5cd90c5aa9499564e2ab4426feecac10bc583de47c329e51d65678be2cc08) |
| **3** | Payout to non-PQC burner address (`0x0A02`) | `revert RecipientNotQuantumSafe` | [`0x893bcd5e...56529d1c`](https://explore.qore.network/tx/0x893bcd5e28e9b947447b9f3b560a4829eae0c0cb4196e126582001cc56529d1c) |
| **4a** | Leaked ECDSA key: hijack policy to `'unlimited'` (`0x0A01`) | `revert InvalidMLDSASignature` | [`0xb856dffe...9781e16d`](https://explore.qore.network/tx/0xb856dffeb4659def65a234bb205e52128a347d3c5fa3b1d7ecb068299781e16d) |
| **4b** | Leaked ECDSA key: `sovereignWithdraw` entire vault (`0x0A01`) | `revert InvalidMLDSASignature` | [`0x39959284...6bc0b2e1`](https://explore.qore.network/tx/0x39959284a135756d9408bef586bcf255436404cde36f6f52e937f96c6bc0b2e1) |
| **5** | Replay of an executed intent | `revert IntentAlreadyUsed` | [`0xeef485f7...b6cd4cc6`](https://explore.qore.network/tx/0xeef485f7650c9086aba3d6fb9f948bbfad7e81f9383e4ada8dcefbc1b6cd4cc6) |
| **6a** | ML-DSA-87 emergency clawback: revoke compromised key + freeze | `frozen=true rotated=true oldKeyBlocked=true` | [`0x598357a9...41673e7`](https://explore.qore.network/tx/0x598357a99946b6bd84ebbdffbf5b95e09ad22b1d22bf4cde6e3d0979f41673e7) |
| **6b** | ML-DSA-87 recovery: unfreeze + restore agent | `frozen=false` | [`0x145953ae...21be619`](https://explore.qore.network/tx/0x145953ae6b5fce31883784b7bc6ddccf04df0d87ee35d0a0e912b1e6c21be619) |

## License

MIT
