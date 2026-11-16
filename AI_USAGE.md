# AI Usage

Keep this file truthful and current: it documents what AI assisted with and what humans/tools verified.

## What AI Assisted With
- **Architecture & Smart Contracts:** Drafting `LatticeWardVault.sol`, `QorePQC.sol`, `IQorePrecompiles.sol`, `VaultFactory.sol`, Foundry unit/fuzz/invariant suites, and `Deploy*.s.sol`.
- **TypeScript Runtime, MCP & Web UI:** Drafting `packages/agent-mcp`, `scripts/verify-qday.ts`, `scripts/convert-fusd.ts`, `packages/web` (Vite + React + `BrowserKeySigner`), `packages/relayer`, and `USABILITY_TEST.md`.
- **Documentation:** Drafting `README.md`, `THREAT_MODEL.md`, and `DRILL_RUNBOOK.md`.

## What Was Verified by Humans & Deterministic Tooling
- **Live Chain Precompile ABI Discovery:** Probing `qorechain-diana` revealed that `0x0A01` (`pqcVerify`) expects `(bytes publicKey, bytes signature, bytes message)` argument order; contracts and mocks were updated to match.
- **Foundry Test Suite (`forge test`):** `36/36` tests passing (unit, fuzz at 512 runs, and 2 invariant suites at 512 runs / 256,000 calls each).
- **QoreScan (`@qorechain/qorescan`):** Static analysis run against `./contracts`, output saved to [`audits/qorescan_stage1.json`](./audits/qorescan_stage1.json).
- **Live Testnet Verification (`qorechain-diana`, Chain ID `9800`):**
  - Hardened `LatticeWardVault` deployed and passed `8/8` live Q-Day breach drill checks (`verify:qday`).
  - Hybrid-signed `MsgConvertCoin` executed live (`1.0` + `49.0` fUSD) and `50.0` ERC-20 fUSD transferred to the reference vault.
  - `VaultFactory` deployed (`0xAEdE5a3B09c9BDC749297C39826C6DDdaF311C5c`) and bytecode verified on-chain.
- **Browser Build (`packages/web`):** `tsc -b && vite build` passes with 0 errors.

## Runtime AI in the Product
- The MCP host LLM proposes agent intents through the closed Zod schema in `packages/agent-mcp/src/schema.ts` (rejecting any non-scoped action).
- `packages/agent-mcp/src/preflight.ts` is wired to `@qorechain/sdk`'s `simulateWithRiskScore` and fails closed when unavailable.
