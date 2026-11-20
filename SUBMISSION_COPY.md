# LatticeWard — Official Hackathon Submission Copy (`build.qorechain.io`)

Ready-to-paste copy aligned with the **Post-Quantum AI Agents** category bounty and **Best AI-Native Build** special award criteria.

---

## 1. Project Description (Paste into the "Description" field — ~2,350 chars, fits comfortably under the form limit)

```text
THE PROBLEM: HOT AI AGENT KEYS MEET Q-DAY

Autonomous AI agents executing treasury payouts need a hot classical secp256k1 key to sign without human popups. Today, a prompt injection or server breach can leak that hot key; on Q-Day, Shor's algorithm derives classical private keys directly from on-chain public keys. Any smart account or vault relying on ecrecover (0x01) or onlyOwner loses everything when a classical key is compromised.

THE SOLUTION: LATTICEWARD (3-LAYER POST-QUANTUM AGENT DEFENSE)

LatticeWard is a post-quantum spend-governance vault and AI agent security engine live on QoreChain Diana Testnet (Chain ID 9800, Vault: 0x9697a96058555b3A0C50b2338440C84B927caB29, Factory: 0xAEdE5a3B09c9BDC749297C39826C6DDdaF311C5c). It assumes every classical key will leak and enforces 3 defense layers:

1. Layer 1 — Protocol-Level Smart-Account Spending Rules (Native x/abstractaccount & Scoped EVM Window):
   Under hybrid secp256k1 + ML-DSA-87 owner authority, x/abstractaccount enforces denom_limits for native uqor (0.1 QOR/tx, 0.3 QOR/day) and bank fUSD (1.0 fUSD/tx, 3.0 fUSD/day), a deny-by-default target allowlist (allowed_evm_calls & MsgOpenEVMWindow allowedTargets restricted to 0x9697...aB29), a 30-day authenticator TTL with instant MsgRevokeAuthenticator kill-switch, and EIP-191 evmAuthSignBytesV2 authenticated proposals logged in a hash-chained JSONL verdict ledger (audits/verdict-ledger.jsonl).

2. Layer 2 (Plane 1) — Scoped EVM Vault Execution (LatticeWardVault.executeScopedAgentIntent):
   Enforces 4 on-chain limits for native QOR and ERC-20 fUSD: (a) per-tx value caps (maxTxValue), rolling daily limits (epochLimit), and replay defense (usedIntents); (b) duration windows (windowExpiresAt, per-intent deadline, rolling epochDuration); (c) allowed asset targets plus a mandatory staticcall to precompile 0x0A02 (pqcKeyStatus) blocking recipients without a registered ML-DSA-87 key; and (d) authenticated intent events.

3. Layer 3 (Plane 2) — Sovereign Control (NIST FIPS 204 ML-DSA-87 via Precompile 0x0A01):
   Every admin and emergency action (configurePolicy, setAssetLimit, sovereignWithdraw, triggerQDayEmergencyClawback, rotateSovereignKey) requires a 4,627-byte ML-DSA-87 signature verified by precompile 0x0A01 (pqcVerify) over block.chainid, vault address, policyNonce++, action tag, and params hash. Zero ecrecover and zero onlyOwner.

4. AI Agent MCP Runtime, 402 Paid API & Consumer Web App:
   Includes a 6-tool MCP server (with latticeward_pay_invoice), an HTTP 402 paid-data API (examples/agent-pays-api) where agents pay invoices directly from the vault (intentId = keccak256(invoiceId)) with replay rejection, an off-chain payee allowlist & per-payee cap gate (config/payee-policy.json, PREFLIGHT_MODE=required|advisory), and a React Web3 app with MetaMask/QoreX connection, 6h Session panel, encrypted browser ML-DSA-87 keys, and one-step Q-Day Emergency Clawback.

LIVE ON-CHAIN & E2E PROOF:
On-chain: 8/8 Q-Day breach drill checks + 5/5 x/abstractaccount defense tests passed live on qorechain-diana, backed by 39/39 Foundry tests and a QoreScan audit. Off-chain gate + 402 API: 7/7 E2E tests passing (prompt-injection denials logged separately as "off-chain gate" in audits/verdict-ledger.jsonl).
```

---

## 2. How We Built It (Paste into the "How it's made" field)

```text
LatticeWard is deployed and verified live on QoreChain Diana Testnet (EVM Chain ID 9800):
- Hardened LatticeWardVault: 0x9697a96058555b3A0C50b2338440C84B927caB29 (qor1j6t6jczc24dn5rzskgecgsxgfwf8e2efp7z6qp)
- Per-User VaultFactory: 0xAEdE5a3B09c9BDC749297C39826C6DDdaF311C5c
- Registered Drill Account & 0x0A02 PQC Recipient: 0xD6891e4Ef67be07b5DE9703Dcc4cf36eF4D15aae (qor166y3unhk00s8kh0fwq7ucn8ndm6dzk4w0gq3kx)

1. SMART CONTRACTS & PRECOMPILE INTEGRATION (Solidity 0.8.24 + OpenZeppelin)
- LatticeWardVault.sol inherits OpenZeppelin's ReentrancyGuard (nonReentrant on all value-moving functions) and calls QoreChain's post-quantum precompiles through our fail-closed QorePQC library:
  * 0x0A01 (pqcVerify): Verifies 2,592-byte ML-DSA-87 public keys and 4,627-byte signatures over sovereignDigest(tag, encodedParams). Any precompile error, short return, or invalid length returns false and reverts with InvalidMLDSASignature.
  * 0x0A02 (pqcKeyStatus): Called inside executeScopedAgentIntent and _executeClawback to ensure funds only flow to quantum-safe addresses with a registered ML-DSA-87 key.
- VaultFactory.sol allows any user to deploy an isolated LatticeWardVault instance in one transaction while holding zero administrative power over deployed vaults.
- Key Discovery on Live Chain: By probing qorechain-diana with scripts/probe-precompiles.ts, we discovered that precompile 0x0A01 expects arguments in the order (bytes publicKey, bytes signature, bytes message) rather than (publicKey, message, signature), and aligned our Solidity wrappers and Foundry mocks to the live node behavior.

2. FOUNDRY SECURITY SUITE (39/39 Tests Passing) & QORESCAN AUDIT
- Unit, Fuzz & Enterprise Exploit Tests (LatticeWard.t.sol, LatticeWardVault.t.sol, VaultFactory.t.sol):
  * Simulates an attacker holding a leaked secp256k1 private key attempting raw 65-byte and 4,627-byte-padded ECDSA signatures against configurePolicy and triggerQDayEmergencyClawback -> verified revert at 0x0A01.
  * Verifies reentrancy protection (ReentrancyGuardReentrantCall), strict policyNonce++ increment, cross-chain and cross-vault signature isolation, duration/expiry windows (WindowExpired, IntentExpired, rolling epochDuration reset), allowed targets (AssetNotAllowed, RecipientNotQuantumSafe), and authenticated intent messaging (AuthenticatedAgentIntentExecuted).
- Invariant Suites (LatticeWardVault.invariant.t.sol, VaultFactory.t.sol):
  * 512 runs / 256,000 randomized calls proving a classical-key attacker or the factory itself can never drain a single wei or mutate policyNonce.
- Static Analysis: Ran @qorechain/qorescan across ./contracts (saved in audits/qorescan_stage1.json).

3. QORECHAIN SDK, NATIVE x/abstractaccount, HYBRID TRANSACTIONS & MCP AGENT SERVER
- Used @qorechain/sdk (EthNativeSigner in hybrid signMode, linkAuthenticatorMsgs, MsgUpdateSpendingRules, MsgRegisterAuthenticator, MsgExecuteEVM, MsgRevokeAuthenticator, evmAuthSignBytesV2, openEvmWindowMsg, closeEvmWindowMsg, simulateWithRiskScore) to configure protocol-level x/abstractaccount spending rules for both uqor and bank fUSD with a 30-day authenticator TTL (tx A374DDC5C787BFAD914F9870F9318DB321C8580EBCC8CA0715505B239D9A9388), close the EVM window on the retired drill account (tx 023BB99C0C6839A32C0A34E04B5A7E70B426E522358189878F92800E6DDE57D4), execute authenticated agent calls via MsgExecuteEVM (tx D3AB9E1E52052BF0AB2D5A559A2EC9AB40D3563F05B5A8B867404D79D6D17E7A), verify live authenticator revocation and restoration (tx 28084ACC143F4E20BAF992CD68D3AB2E31A066944073F7BE1581F740BB361D11 and C5482CDF1F73675F30A683B738C111C105FD6F3856B812E4C529C31A8E349329), and convert 50.0 bank-coin fUSD into ERC-20 fUSD via hybrid MsgConvertCoin.
- Built a 5-tool MCP server (@modelcontextprotocol/sdk) plus @qorechain/mcp and @qorechain/qore-cli integration gated by a fail-closed Zod schema, a hash-chained policy verdict ledger (audits/verdict-ledger.jsonl), and simulateWithRiskScore pre-flight checks.

4. CONSUMER WEB3 FRONTEND & STATELESS RELAYER (Vite + React + TypeScript)
- Connects QoreX (@qorechain/qorex-types EIP-6963 + window.qorex.native) for scoped EVM windows (with allowedTargets) and MetaMask for EVM execution.
- Implements BrowserKeySigner (@noble/post-quantum ml_dsa87 encrypted via WebCrypto PBKDF2 310,000 iterations + AES-256-GCM in IndexedDB with mandatory .lwkey.json backup confirmation).
- Features a 0x0A02 Wallet & Quantum Status Gate, Live Vault Telemetry Dashboard, Consumer Guardrail Configurator, Scoped Agent Payout Simulator/Executor, and an ML-DSA-87 Q-Day Emergency Clawback & Freeze Kill-Switch.
```
