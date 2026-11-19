# LatticeWard

[![Built on QoreChain](https://build.qorechain.io/badge/latticeward.svg)](https://build.qorechain.io/p/latticeward)

**Post-quantum spend-governance & Q-Day immunity engine for autonomous AI agents on QoreChain.**

Built for the QoreChain Developer Fest **"Build Before Q-Day"** (Post-Quantum AI Agents track). Target network: `qorechain-diana` (EVM Chain ID `9800`).

---

## 1. Architecture & Dual-Plane Security Model

AI agents need hot `secp256k1` keys to sign payouts without human popups. Today a prompt injection or server breach can leak that key; on Q-Day, Shor's algorithm derives classical private keys directly from public keys on-chain. LatticeWard assumes **every classical key will be compromised** and splits authority into two planes:

```mermaid
flowchart TD
    subgraph Plane1["Plane 1: Scoped Agent Execution (Classical secp256k1)"]
        A["AI Agent / MCP Server"] -->|"Zod Intent Guard + simulateWithRiskScore"| B["executeScopedAgentIntent (nonReentrant)"]
        B -->|"1. Check per-tx cap & rolling daily limit"| C["On-Chain Policy Guardrails"]
        C -->|"2. Staticcall 0x0A02 pqcKeyStatus(recipient)"| D["QoreChain 0x0A02 Precompile"]
        D -->|"registered == true"| E["Transfer Native QOR / ERC-20 fUSD"]
    end

    subgraph Plane2["Plane 2: Sovereign Control (NIST FIPS 204 ML-DSA-87)"]
        F["Sovereign Lattice Key (4,627-byte sig)"] -->|"sovereignDigest(chainId, vault, policyNonce++, tag, params)"| G["configurePolicy / setAssetLimit / sovereignWithdraw / triggerQDayEmergencyClawback"]
        G -->|"Staticcall 0x0A01 pqcVerify(pk, sig, digest)"| H["QoreChain 0x0A01 Precompile"]
        H -->|"Verified == true"| I["Mutate Policy / Freeze / Rotate Agent / Sweep to 0x0A02 Rescue"]
    end

    subgraph Factory["Per-User Isolation"]
        J["VaultFactory (0xAEdE...1C5c)"] -->|"createVault(sovereignKeyHash, policy, assets)"| K["Isolated User LatticeWardVault"]
    end
```

| Plane | Key | Allowed Actions | On-Chain Enforcement |
|---|---|---|---|
| **Execution (Plane 1)** | Disposable `secp256k1` `agentKey` | Pay out inside a scoped window: per-asset `maxTxValue`, rolling `epochLimit` (daily limit), `windowExpiresAt`, asset allowlist (`assetLimits`), replay-protected intents (`usedIntents`), recipient must pass `QorePQC.isRegistered` / `IPQCKeyStatus(0x0000000000000000000000000000000000000A02).pqcKeyStatus` (`0x0A02`) | `LatticeWardVault.executeScopedAgentIntent` (`nonReentrant`) |
| **Sovereign (Plane 2)** | `ML-DSA-87` (FIPS 204) | `configurePolicy`, `setAssetLimit`, `sovereignWithdraw`, `triggerQDayEmergencyClawback` (`emergencyClawback`), `rotateSovereignKey` | `QorePQC.verify` / `IPQCVerify(0x0000000000000000000000000000000000000A01).pqcVerify` (`0x0A01`) over `sovereignDigest` bound to `block.chainid` + `address(this)` + `policyNonce++` + `tag` + `keccak256(params)` |

The vault has **no `ecrecover` and no `onlyOwner`**. `msg.sender` carries zero administrative authority, so a leaked classical key cannot escalate privileges, alter limits, or drain the treasury.

---

## 2. Repository Layout

```text
contracts/            LatticeWardVault.sol, VaultFactory.sol, libraries/QorePQC.sol, interfaces/IQorePrecompiles.sol
contracts/test/       LatticeWard.t.sol, LatticeWardVault.t.sol, LatticeWardVault.invariant.t.sol, VaultFactory.t.sol
script/               Deploy.s.sol, DeployFactory.s.sol
packages/agent-mcp/   abi.ts, config.ts, schema.ts (Zod), pqc.ts, precompiles.ts, preflight.ts, agent.ts, drill.ts, sovereign.ts, mcp-server.ts
packages/web/         Vite + React + TypeScript frontend (0x0A02 Quantum Status Gate, Live Telemetry, Guardrail Configurator, Agent Executor, Kill-Switch)
packages/relayer/     Stateless serverless relayer + CORS evm-window proxy (Vercel)
scripts/              probe-precompiles.ts, check-window.ts, convert-fusd.ts, fund-vault.ts, gen-sovereign-key.ts, sovereign-cli.ts, verify-qday.ts
audits/               qorescan_stage1.json (@qorechain/qorescan static analysis report)
docs:                 THREAT_MODEL.md, AI_USAGE.md, SUBMISSION_COPY.md, DRILL_RUNBOOK.md, USABILITY_TEST.md, LICENSE
```

---

## 3. Quickstart & Verification Commands

```bash
npm install
npm --prefix packages/web install

# 1. Smart Contract Suite (39/39 unit, fuzz, hardening & invariant tests)
forge test -vv

# 2. TypeScript & Production Web Build
npm run typecheck
npm run build

# 3. Live Testnet Precompile Probe & Q-Day Breach Drill (qorechain-diana, Chain ID 9800)
cp .env.example .env              # populate testnet RPC & keys
npm run probe                     # verify live 0x0A01 & 0x0A02 precompile ABIs
npm run check:windows             # inspect PQC registration & EVM window status
npm run verify:qday               # run 8-scenario live Q-Day breach drill
npm run mcp                       # start LatticeWard 5-tool MCP server over stdio
npm run mcp:qorechain             # start @qorechain/mcp (qorechain-mcp) server (configured in .mcp.json & .cursor/mcp.json)
npm run qore:status               # query qorechain-diana via qore CLI (@qorechain/qore-cli)
npm run qore:inspect              # inspect PQC registration status via qore CLI

# 4. Run Local Web UI
cd packages/web && npm run dev    # http://127.0.0.1:5173
```

---

## 4. Live Testnet Deployment (`qorechain-diana`, Chain ID `9800`)

- **Hardened `LatticeWardVault` (`VAULT_ADDRESS`):** `0x9697a96058555b3A0C50b2338440C84B927caB29` (`qor1j6t6jczc24dn5rzskgecgsxgfwf8e2efp7z6qp`)
  - Deploy Tx: [`0xce42a4cd136064c000170a7f2d03193b1fe1f3e02e60a2094ffeb10dde6c7e84`](https://explore.qore.network/tx/0xce42a4cd136064c000170a7f2d03193b1fe1f3e02e60a2094ffeb10dde6c7e84)
  - Vault QOR Funding Tx (`1.0 QOR`): [`0x62106213413a97a740c39235390fcfbcf2e3e3502dfe545c96a4b9c8e02ee4c5`](https://explore.qore.network/tx/0x62106213413a97a740c39235390fcfbcf2e3e3502dfe545c96a4b9c8e02ee4c5)
  - Drill Account Normal Vault Deposit Tx (`0.01 QOR` from `0xD689...5aae`): [`0xe25725c68d99c780dd997b0f59792eb50061a4eb7c64c23e30437e7f9d0a9e53`](https://explore.qore.network/tx/0xe25725c68d99c780dd997b0f59792eb50061a4eb7c64c23e30437e7f9d0a9e53) (Cosmos hash: `56B44D5F648C3846239F35A09B6BEE6F8359CAA7CE6F8DA20957E6531BFD3F16`; Hybrid `MsgOpenEVMWindow`: `A5F5F2818ECF5EB26ED2185227AEBD5A62AED136FE75AAD330A31EAAEAF5934A`)
  - Hybrid `MsgConvertCoin` Txs (Cosmos lane, `eth_secp256k1` + `ML-DSA-87`):
    - `1.0 fUSD` (Block `10156333`): `749C8D5FC198C51DF517F43479E3AFD3BE09AEFE50CC9A83EF5F528AA86FF303`
    - `49.0 fUSD` (Block `10156945`): `244983ED2FF685777D3494003FBB69A018EABB37C193A3737AC3AEB62E922F01`
  - Vault ERC-20 `fUSD` Funding Tx (`50.0 fUSD`): [`0x4df234b8fa8a22118423433839cd215c4116c4c06df2654f87cb89cbf07c2ad2`](https://explore.qore.network/tx/0x4df234b8fa8a22118423433839cd215c4116c4c06df2654f87cb89cbf07c2ad2)
- **`VaultFactory` (per-user vault deployer):** `0xAEdE5a3B09c9BDC749297C39826C6DDdaF311C5c`
  - Deploy Tx: [`0xea6b9acd6908ea7294e57087ba6448e340685509525f50b49cdc283d3ed594ff`](https://explore.qore.network/tx/0xea6b9acd6908ea7294e57087ba6448e340685509525f50b49cdc283d3ed594ff)
- **Sovereign ML-DSA-87 Key Hash (`sovereignKeyHash`):** `0xfc4c13af8aac8233f2566485d7ca4ba7ef53db50c07aebad3630cf2058178d23`
- **Registered Drill Account & PQC Recipient (`0x0A02` registered):** `0xD6891e4Ef67be07b5DE9703Dcc4cf36eF4D15aae` (`qor166y3unhk00s8kh0fwq7ucn8ndm6dzk4w0gq3kx`)
- **Scoped Agent (disposable hot key):** `0xc40352672Ac28fD9DE498AbE2c3CedF9367FDE04` (`qor1csp4yee2c28anhjf32lzc08dlym8lhsydmhj6l`)
- **Deployer / Submitter:** `0x480261F742b3CfA5f1659da6FAd089BDB6CFD0B3` (`qor1fqpxra6zk086tut9nkn045yfhkmvl59nlnegea`)
- **fUSD (FestUSD, 6 decimals):** `0x97143B771D34ddb9130b807b135Ae675A5a963CA`

### Live Q-Day Breach Drill Proof (`8/8 PASS`)

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

---

## 5. Credits & Attribution

- **QoreChain Kits & Precompiles:**
  - `@qorechain/sdk` (`EthNativeSigner`, `openEvmWindowMsg`, `simulateWithRiskScore`, `deriveUnifiedAccount`)
  - `@qorechain/qorex-types` (EIP-6963 QoreX wallet discovery & `window.qorex.native` capabilities)
  - `@qorechain/qorescan` (Solidity post-quantum static analysis & cryptographic bill of materials)
  - Precompiles `0x0A01` (`pqcVerify`, ML-DSA-87 / FIPS 204) and `0x0A02` (`pqcKeyStatus`)
- **Libraries & Tooling:**
  - `@openzeppelin/contracts` (`ReentrancyGuard`)
  - `@noble/post-quantum` (FIPS 204 `ml_dsa87`)
  - `@modelcontextprotocol/sdk` (5-tool MCP server)
  - Foundry (`forge-std`)

## License

[MIT](./LICENSE)
