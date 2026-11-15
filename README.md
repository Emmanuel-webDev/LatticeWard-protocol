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

## Status (read this)

Written in an environment without a Solidity compiler, Foundry, or network access. **Nothing here has been compiled, tested, or run against the testnet yet.** Known open items:

- `0x0A01` `pqcVerify` calldata layout is **assumed** `(pk, message, sig)`; `npm run probe` determines the real one. `0x0A02` shape comes from the qorechain-sdk docs.
- `simulateWithRiskScore` call shape in `@qorechain/sdk` 0.7.0 is unconfirmed (`preflight.ts`, fail-closed until wired).
- ML-DSA context string / signing mode used by the chain verifier must match `@noble/post-quantum` (empty context assumed).
- Web Command Center UI (`packages/web`) is not started. DCA via an allowlisted router is not implemented (v0.1 = payouts only).
- QCAI / `qorescan --solidity` audits not yet run: see `audits/README.md`.

## Deployed addresses

TBD after Sprint 1.

## License

MIT
