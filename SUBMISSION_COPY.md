# LatticeWard — Official Hackathon Submission Copy (`build.qorechain.io`)

Ready-to-paste copy aligned with the **Post-Quantum AI Agents** category bounty and **Best AI-Native Build** special award criteria.

---

## 1. Project Description (Paste into the "Description" field)

```text
THE PROBLEM: HOT AI AGENT KEYS MEET Q-DAY

Autonomous AI agents that execute treasury operations (vendor payouts, recurring settlements, DeFi automation) need a hot classical secp256k1 key to sign transactions without a human popup. Today, a prompt injection or server breach can leak that hot key. On Q-Day, Shor's algorithm will derive classical private keys directly from on-chain public keys. Any smart account or treasury vault that relies on ecrecover (0x01) or onlyOwner for administrative control loses everything when a classical key is compromised.

THE SOLUTION: LATTICEWARD

LatticeWard is a post-quantum spend-governance vault and AI agent security engine deployed on QoreChain Diana Testnet (Chain ID 9800, Vault: 0x9697a96058555b3A0C50b2338440C84B927caB29, Factory: 0xAEdE5a3B09c9BDC749297C39826C6DDdaF311C5c). It assumes every classical key will eventually leak and splits authority into two cryptographically isolated planes:

1. Plane 1 — Scoped Agent Execution (Disposable Classical Key + 4-Dimensional Guardrails):
   The hot agent key can only call executeScopedAgentIntent, which enforces four strict limits on-chain:
   - Value & Transaction Limits: Per-transaction value caps (maxTxValue), rolling daily spend caps (epochLimit), and per-intent replay protection (usedIntents[intentId]).
   - Duration & Expiry Windows: Global authorization window expiry (windowExpiresAt), per-intent deadlines (deadline), and bounded rolling epoch durations (epochDuration).
   - Allowed Targets & 0x0A02 Quantum-Safety Firewall: Per-asset allowlist (assetLimits[target].enabled) plus a mandatory staticcall to QoreChain precompile 0x0A02 (pqcKeyStatus) that blocks payouts to any recipient without a registered ML-DSA-87 key.
   - Authenticated Agent Messaging: Verifies the authorized agentKey and emits AuthenticatedAgentIntentExecuted(intentId, target, recipient, value, riskScoreBps, rationaleHash).

2. Plane 2 — Sovereign Control (NIST FIPS 204 ML-DSA-87 via Precompile 0x0A01):
   Every administrative and emergency action (configurePolicy, setAssetLimit, sovereignWithdraw, triggerQDayEmergencyClawback, rotateSovereignKey) requires a 4,627-byte ML-DSA-87 signature verified on-chain by precompile 0x0A01 (pqcVerify). Each signature is bound to block.chainid, the vault address, a strictly incrementing policyNonce++, the action tag, and keccak256(params). The contract contains zero ecrecover and zero onlyOwner logic: msg.sender carries no administrative authority, making classical key theft useless for privilege escalation.

3. AI Agent MCP Runtime & Consumer Web App:
   - A fail-closed Zod intent grammar and @qorechain/sdk simulateWithRiskScore pre-flight gate prevent prompt-injected agents from expressing out-of-policy actions, exposed via a 5-tool MCP server.
   - A consumer Web3 application (Vite + React + TypeScript) connects QoreX (scoped EVM windows + native hybrid signing) and MetaMask, verifies live 0x0A02 quantum protection, manages encrypted browser ML-DSA-87 keys (PBKDF2 + AES-256-GCM in IndexedDB), deploys isolated per-user vaults via VaultFactory, simulates and executes scoped agent payouts, and provides a one-step ML-DSA-87 Q-Day Emergency Clawback & Freeze kill-switch.

LIVE ON-CHAIN PROOF:
Verified live on qorechain-diana (8/8 Q-Day breach drill checks passed on 0x9697a96058555b3A0C50b2338440C84B927caB29, funded with native QOR and 50.0 ERC-20 fUSD via hybrid-signed MsgConvertCoin) and backed by 39/39 passing Foundry unit, fuzz, and invariant tests plus a QoreScan static audit.
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

3. QORECHAIN SDK, HYBRID TRANSACTIONS & MCP AGENT SERVER
- Used @qorechain/sdk (EthNativeSigner in hybrid signMode, openEvmWindowMsg, deriveUnifiedAccount, simulateWithRiskScore) to open scoped EVM authorization windows and execute live hybrid-signed (eth_secp256k1 + ML-DSA-87) Cosmos MsgConvertCoin transactions converting 50.0 bank-coin fUSD into ERC-20 fUSD to fund the vault.
- Built a 5-tool MCP server (@modelcontextprotocol/sdk) gated by a fail-closed Zod schema and simulateWithRiskScore pre-flight check.

4. CONSUMER WEB3 FRONTEND & STATELESS RELAYER (Vite + React + TypeScript)
- Connects QoreX (@qorechain/qorex-types EIP-6963 + window.qorex.native) for scoped EVM windows (with allowedTargets) and MetaMask for EVM execution.
- Implements BrowserKeySigner (@noble/post-quantum ml_dsa87 encrypted via WebCrypto PBKDF2 310,000 iterations + AES-256-GCM in IndexedDB with mandatory .lwkey.json backup confirmation).
- Features a 0x0A02 Wallet & Quantum Status Gate, Live Vault Telemetry Dashboard, Consumer Guardrail Configurator, Scoped Agent Payout Simulator/Executor, and an ML-DSA-87 Q-Day Emergency Clawback & Freeze Kill-Switch.
```
