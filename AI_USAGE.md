# AI Usage & Engineering Verification Report (`AI_USAGE.md`)

**Project:** LatticeWard — Post-Quantum Spend-Governance & Q-Day Immunity Engine for Autonomous AI Agents  
**Network:** QoreChain Diana Testnet (`qorechain-diana`, EVM Chain ID `9800`)  
**Live Hardened Vault:** `0x9697a96058555b3A0C50b2338440C84B927caB29` (`qor1j6t6jczc24dn5rzskgecgsxgfwf8e2efp7z6qp`)  
**Live `VaultFactory`:** `0xAEdE5a3B09c9BDC749297C39826C6DDdaF311C5c`

This document details how AI coding agents were used across the LatticeWard build and how human engineering decisions directed, audited, hardened, and verified every deliverable on-chain.

---

## 1. AI Workflow & Tooling Used During Development

We used AI coding agents (Claude / Antigravity agentic workflow) inside an iterative **Specify → Probe Live Chain → Harden → Verify (`forge test` + `qorescan` + live testnet drill)** loop:

1. **Smart Contract & Test Scaffolding (`contracts/`):**
   - Assisted with drafting `LatticeWardVault.sol`, `VaultFactory.sol`, `libraries/QorePQC.sol`, `interfaces/IQorePrecompiles.sol`, and the 5 Foundry test suites (`39/39` passing unit, fuzz, and invariant tests).
2. **TypeScript Agent Runtime, `x/abstractaccount` Pipeline & MCP Server (`src/`, `packages/agent-mcp/`, `scripts/`):**
   - Assisted with drafting the protocol-level `x/abstractaccount` spending rules and authenticator linker (`src/abstractAccount.ts`, `scripts/setup-abstract-account.ts`), the cryptographically signed agent proposal and hash-chained verdict ledger pipeline (`src/authenticatedAgent.ts`, `scripts/verify-defense.ts`), the closed Zod intent schema (`schema.ts`), the fail-closed `simulateWithRiskScore` pre-flight wrapper (`preflight.ts`), the 5-tool Model Context Protocol server (`mcp-server.ts`), the hybrid-signed `MsgConvertCoin` script (`scripts/convert-fusd.ts`), and the 8-scenario live Q-Day breach drill (`scripts/verify-qday.ts`).
3. **Consumer Web3 Frontend & Stateless Relayer (`packages/web/`, `packages/relayer/`):**
   - Assisted with scaffolding the Vite + React + TypeScript frontend (`BrowserKeySigner` with WebCrypto PBKDF2 + AES-256-GCM in IndexedDB, `0x0A02` Quantum Status Gate, Live Vault Telemetry Dashboard, Consumer Guardrail Configurator, Scoped Agent Intent Executor, and `0x0A01` Q-Day Emergency Kill-Switch) and the stateless serverless relayer.

---

## 2. Human Engineering Decisions, Audits & Security Hardening

No AI-generated code was trusted blindly. Every security-critical boundary was directed, reviewed, and verified by human engineering decisions and deterministic tooling:

| Component / Decision | Initial Draft / Risk | Human-Directed Hardening & Verification |
|---|---|---|
| **1. Zero Classical Admin Fallbacks** | Standard smart-account templates often include `ecrecover` (`0x01`) or `onlyOwner` (`msg.sender`) admin paths. | Strictly prohibited `ecrecover` and `onlyOwner` across `LatticeWardVault.sol` and `VaultFactory.sol`. Every administrative and emergency mutation (`configurePolicy`, `setAssetLimit`, `sovereignWithdraw`, `triggerQDayEmergencyClawback`, `rotateSovereignKey`) requires a 4,627-byte NIST FIPS 204 ML-DSA-87 signature verified on-chain via precompile `0x0A01` (`pqcVerify`). |
| **2. Live Precompile `0x0A01` ABI Discovery** | Assumed `pqcVerify` argument order `(publicKey, message, signature)` from generic docs. | Built and ran `scripts/probe-precompiles.ts` against live `qorechain-diana` (`Chain ID 9800`). Discovered the live precompile requires `(bytes publicKey, bytes signature, bytes message)`. Updated `QorePQC.sol`, `IQorePrecompiles.sol`, and `MockPQC.sol` to match the real chain. |
| **3. Four-Dimensional Scoped Agent Limits** | A compromised or prompt-injected agent could attempt to drain funds via high value, rapid repeats, expired windows, or unapproved tokens/recipients. | Enforced all 4 limits on-chain in `executeScopedAgentIntent`: **(a) Value/Tx Caps** (`maxTxValue`, `usedIntents[intentId]`), **(b) Duration/Expiry Windows** (`windowExpiresAt`, per-intent `deadline`, rolling `epochDuration` bounded by `MAX_EPOCH_DURATION = 365 days`), **(c) Allowed Targets** (`assetLimits[target].enabled` + `0x0A02` `pqcKeyStatus(recipient)` firewall + self/zero-address block), and **(d) Authenticated Messaging** (`msg.sender == agentKey` + `AuthenticatedAgentIntentExecuted` event). |
| **4. Reentrancy & Strict Nonce Replay Defense** | Outbound native `QOR` transfers or replayed off-chain ML-DSA signatures could re-enter or replay state transitions. | Integrated OpenZeppelin `ReentrancyGuard` (`nonReentrant` on all value-moving functions) + Checks-Effects-Interactions, and enforced strict `policyNonce++` increment inside `_authorizeSovereign` bound to `block.chainid`, `address(this)`, `policyNonce`, action `tag`, and `keccak256(params)`. |
| **5. Strict Fail-Closed AI Pre-Flight (`preflight.ts`)** | Risk of offline/mock fallbacks silently allowing high-risk transactions when RPC simulation is unreachable. | Verified via `git grep` that zero offline fallback flags exist in production code: if `@qorechain/sdk`'s `simulateWithRiskScore` errors or returns `riskScore >= threshold`, `agent.ts` fails closed and refuses to broadcast. |
| **6. Browser Key Custody & Zero Key Leakage** | Deriving ML-DSA keys from MetaMask ECDSA signatures would re-introduce a classical bottleneck. | Designed `BrowserKeySigner` to generate true random ML-DSA-87 keys (`@noble/post-quantum`) encrypted with PBKDF2 (`310,000` iterations) + AES-256-GCM in IndexedDB, with mandatory `.lwkey.json` backup verification before vault creation. Scanned all git commits (`git log --all`) to confirm zero private keys or mnemonics were ever committed. |
| **7. Protocol-Level `x/abstractaccount` Smart-Account Spending Rules & Hash-Chained Verdict Ledger** | Relying solely on Solidity contract checks leaves the agent account unconstrained at the Cosmos/EVM protocol boundary. | Integrated `@qorechain/sdk`'s `x/abstractaccount` (`linkAuthenticatorMsgs`, `MsgUpdateSpendingRules`, `MsgRegisterAuthenticator`, `MsgExecuteEVM`, `MsgRevokeAuthenticator`) under hybrid `eth_secp256k1 + ML-DSA-87` owner authority (`denom_limits` for `uqor` (`100,000/tx, 300,000/day`) and bank `fUSD` (`erc20:0x9714...63CA`: `1,000,000/tx, 3,000,000/day`), deny-by-default `allowed_evm_calls: [0x9697...aB29]`, 30-day `expiry_unix`, EIP-191 `evmAuthSignBytesV2` authenticated proposals), closed the EVM window on the retired public drill account (`023BB99C...57D4`), and recorded every policy verdict in a hash-chained JSONL ledger (`audits/verdict-ledger.jsonl`). |

---

## 3. Runtime AI in the Product

1. **Closed Zod Intent Grammar ([packages/agent-mcp/src/schema.ts](./packages/agent-mcp/src/schema.ts)):**
   - The MCP host LLM (Claude Desktop / Cursor) can only emit a strict discriminated union (`EXECUTE_WITHIN_SCOPE` or `REJECT_OUT_OF_POLICY`). Any prompt-injected instruction attempting to call `configurePolicy`, `setAssetLimit`, or `sovereignWithdraw` is impossible to express in the agent grammar and is rejected before any RPC call.
2. **Protocol-Level AI Risk Pre-Flight ([packages/agent-mcp/src/preflight.ts](./packages/agent-mcp/src/preflight.ts)):**
   - Wired to `@qorechain/sdk`'s `simulateWithRiskScore` (`@qorechain/evm`) as a fail-closed gate prior to transaction broadcast.
3. **5-Tool MCP Server & `@qorechain/mcp` + `qore` CLI Integration ([packages/agent-mcp/src/mcp-server.ts](./packages/agent-mcp/src/mcp-server.ts), [.mcp.json](./.mcp.json), [.cursor/mcp.json](./.cursor/mcp.json)):**
   - Exposes `latticeward_get_vault_and_pqc_status`, `latticeward_simulate_agent_intent`, `latticeward_execute_scoped_settlement`, `latticeward_trigger_qday_breach_drill`, and `latticeward_verify_pqc_receipt` alongside `@qorechain/mcp` (`npx -y @qorechain/mcp` / `qorechain-mcp`) and `@qorechain/qore-cli` (`qore status`, `qore pqc status`).

---

## 4. Deterministic Verification Summary

- **Foundry Tests (`forge test -vv`):** `39/39` passing across 5 test suites (including 2 invariant suites running `512` fuzz runs / `256,000` calls each with `0` reverts).
- **Static Analysis (`@qorechain/qorescan`):** Saved in [`audits/qorescan_stage1.json`](./audits/qorescan_stage1.json) (`10` ML-DSA-87 / precompile occurrences detected).
- **Live Testnet Q-Day Breach Drill (`npm run verify:qday`):** `8/8` checks passed live on `qorechain-diana` against `0x9697a96058555b3A0C50b2338440C84B927caB29`.
- **Live Testnet 3-Layer `x/abstractaccount` Defense Verification (`npm run verify:defense`):** `allPassed: true` across 30-day authenticator link + dual `denom_limits` (`A374DDC5...9388`), retired drill account EVM window closure (`023BB99C...57D4`), in-policy `MsgExecuteEVM` (`D3AB9E1E...7E7A`), out-of-policy value/duration/target refusals (`D3E87638...BA65`), and live authenticator revocation & 30-day restoration (`28084ACC...1D11` / `C5482CDF...9329`), saved in [`audits/onchain-proof.json`](./audits/onchain-proof.json) and [`audits/verdict-ledger.jsonl`](./audits/verdict-ledger.jsonl).
