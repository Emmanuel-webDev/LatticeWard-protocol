# LatticeWard Usability Test Script & SUS Questionnaire

**Scope:** Testnet prototype (`qorechain-diana`, Chain ID `9800`) — 5-task moderated usability test for 3 non-technical participants, followed by the System Usability Scale (SUS).

**Before the session:**
- Ensure the participant has a desktop or mobile browser with **QoreX** and **MetaMask** installed (funded with testnet QOR).
- Ask them to think aloud. Do not guide them unless they are completely stuck for >60 seconds; note where they hesitate.

---

## 5-Task Usability Script

### Task 1: Create Your Isolated Vault
- **Prompt:** *"You want to set up a protected treasury vault for an AI assistant on testnet. Connect your wallets, set up your recovery key, and create your vault."*
- **Observe:**
  - Did the participant understand why both QoreX and MetaMask are needed?
  - Did they download and confirm the `.lwkey.json` backup without confusion?
  - Did they understand the calm key-custody notice?
- **Success criteria:** Vault deployed via `VaultFactory.createVault` and shown as **Active** on the Dashboard.

### Task 2: Deposit Testnet QOR
- **Prompt:** *"Put `0.1 QOR` into your new vault so your AI assistant has funds to work with."*
- **Observe:**
  - Did they find the Deposit section on the Dashboard?
  - If they looked at fUSD, did the message about bank-coin vs ERC-20 fUSD make sense?
- **Success criteria:** Vault QOR balance updates to `0.1 QOR`.

### Task 3: Set a Daily Allowance
- **Prompt:** *"Change your vault's allowance to the Cautious preset (up to `0.1 QOR` per payment, `0.3 QOR` per day) and make sure the quantum-safety firewall stays ON."*
- **Observe:**
  - Did they understand what "daily limit" means (*the day starts at the first payment*)?
  - Did the before/after summary give them confidence before signing with their Lattice key?
- **Success criteria:** `setAssetLimit` transaction succeeds and Dashboard shows `Up to 0.1 QOR per payment, 0.3 QOR per day`.

### Task 4: Emergency Freeze
- **Prompt:** *"Imagine your AI assistant's computer was hacked. Freeze the vault immediately."*
- **Observe:**
  - Did they find **Hold to Freeze Vault** quickly?
  - Did they understand the EVM window check / warning if MetaMask was used?
- **Success criteria:** Vault badge changes to **Frozen (Paused)** (icon + colour + text).

### Task 5: Unfreeze the Vault
- **Prompt:** *"The incident is resolved. Unfreeze your vault so normal payments can resume."*
- **Observe:**
  - Was it clear how to unfreeze using their Lattice key?
- **Success criteria:** Vault badge returns to **Active**.

---

## System Usability Scale (SUS) Questionnaire

Rate each statement from **1 (Strongly Disagree)** to **5 (Strongly Agree)**:

1. I think that I would like to use this system frequently.
2. I found the system unnecessarily complex.
3. I thought the system was easy to use.
4. I think that I would need the support of a technical person to be able to use this system.
5. I found the various functions in this system were well integrated.
6. I thought there was too much inconsistency in this system.
7. I would imagine that most people would learn to use this system very quickly.
8. I found the system very cumbersome to use.
9. I felt very confident using the system.
10. I needed to learn a lot of things before I could get going with this system.

**Scoring:**
- For odd items (`1, 3, 5, 7, 9`): `score - 1`
- For even items (`2, 4, 6, 8, 10`): `5 - score`
- Sum all 10 adjusted scores and multiply by `2.5` (range `0–100`; target `>= 70`).
