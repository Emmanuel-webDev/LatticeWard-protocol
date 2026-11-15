# AI Usage

Keep this file truthful and current: it is a scoring artifact. Replace the TODOs with what you actually did.

## Used so far
- Claude (Anthropic) assisted with: PRD analysis, drafting `LatticeWardVault.sol`, the Foundry test suite, the TypeScript agent/MCP layer, and documentation.
- All AI-written code is **unreviewed and uncompiled** at the time of this commit.

## Runtime AI in the product
- The MCP host LLM (Claude Desktop / Cursor) proposes intents. It can only emit the closed Zod grammar in `schema.ts`; everything else is rejected.
- QoreChain `simulateWithRiskScore` is the protocol-level anomaly gate before broadcast (wiring pending).

## TODO (fill in with real work, do not pre-write claims)
- [ ] Adversarial prompt-injection test corpus run against `schema.ts` + results.
- [ ] How Stage-1 QCAI / qorescan findings were triaged and fixed with AI help.
- [ ] Human review notes for each contract change.
