# Q-Day Drill Runbook

Deadline: **registration closes 17 Nov 23:59 UTC**. Bot attacks 18 Nov. Submit a normal-tx hash by 19 Nov.

## Three keys, three jobs
| Key | Role | Where it lives |
|---|---|---|
| **Drill account** (classical key goes to the bot, then published) | the account you register in the portal | holds **gas dust only** |
| **Agent key** | disposable Plane-1 key in the vault | `.env`, tiny caps |
| **Sovereign ML-DSA-87 key** | the only admin authority | offline; never in the drill account, never in the portal |

## Important corrections to earlier advice
- **Do not fund the drill account with 20 QOR + 200 fUSD.** The bot gets its classical key. Anything it holds is exposed unless the chain enforces PQC-only transfers, which we have not verified. Put working funds in the **vault**; leave the drill account with enough for a few txs.
- "Restrict the drill account's classical execution window" is **unverified**: do not rely on it. The vault is the protection we control.
- The vault has no `onlyOwner`, so the drill key cannot administer it regardless of who deployed it.

## Steps
1. GitHub: public repo `latticeward-protocol`, MIT. Push this folder.
2. `build.qorechain.io/start` -> Create project (category: Post-Quantum AI Agents). Install the QoreChain Build GitHub App from My space.
3. QoreX: new account "LatticeWard Drill Account", fund via faucet, confirm ML-DSA-87 key registered (`ensurePqcRegistered`). Check: `npm run probe -- <drill 0x address>`.
4. `npm run probe` to confirm precompile ABI. **Fix `QorePQC.verify` if the probe says the order differs, before deploying.**
5. `npm run gen:sovereign`; copy the public key into `.env` and `export LW_SOVEREIGN_PUBKEY=0x...`.
6. Deploy (tiny caps; example):
   ```bash
   export DEPLOYER_PRIVATE_KEY=0x... LW_AGENT=0xAgentAddr FUSD_ADDRESS=0x... LW_WINDOW_DAYS=14
   export LW_MAX_TX_FUSD=1000000000000000000 LW_EPOCH_LIMIT_FUSD=3000000000000000000
   export LW_MAX_TX_QOR=100000000000000000  LW_EPOCH_LIMIT_QOR=300000000000000000
   forge script script/Deploy.s.sol --rpc-url $QOR_EVM_RPC --broadcast
   ```
7. Fund the vault with some fUSD/QOR. Put `VAULT_ADDRESS` in `.env`. Run `npm run verify:qday`; do not register until it is green.
8. Portal -> Q-Day Drill: paste the **drill account's classical key** and the vault address. Submit before the deadline.
9. 18-19 Nov: make a normal tx from the drill account through the vault, e.g. `npm run sovereign -- withdraw fUSD <PQC-registered address> 1` with `SUBMITTER_PRIVATE_KEY` = drill key. Paste the hash on the project page.
   - **Open question:** the portal says the drill account should sign with its ML-DSA-87 key. A contract-level ML-DSA signature (what the vault checks) is not the same as a hybrid-signed *transaction* from QoreX. Ask in the fest channel which the judges expect; if hybrid-tx is required, send the vault call from QoreX / `@qorechain/sdk` hybrid signing.
