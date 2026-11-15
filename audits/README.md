# Audits

No audit reports exist yet. Do not commit placeholder or invented reports.

Stage 1 (pre-fix):
```bash
npx @qorechain/qorescan solidity ./contracts --out audits/qorescan_stage1.json
# run the QCAI audit per build.qorechain.io instructions; save output as QCAI_STAGE_1_INITIAL.md
```
Fix findings, re-run, and save `QCAI_STAGE_2_FINAL.md` + `qorescan_stage2.json`.
Expected qorescan output: precompile calls to `0x0A01` / `0x0A02`, and **no `ecrecover`**.
