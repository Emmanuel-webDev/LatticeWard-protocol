/** npm run verify:qday : live, no-mocks Q-Day drill against the deployed vault on qorechain-diana. */
import { writeFileSync } from "node:fs";
import { runQDayDrill } from "../packages/agent-mcp/src/drill.js";

const t0 = Date.now();
const results = await runQDayDrill();

for (const r of results) {
  const mark = r.skipped ? "SKIP" : r.passed ? "PASS" : "FAIL";
  console.log(`[${mark}] ${r.id.padEnd(3)} ${r.name}`);
  console.log(`        expected: ${r.expected} | observed: ${r.observed}`);
  if (r.explorer ?? r.txHash) console.log(`        tx: ${r.explorer ?? r.txHash}`);
}
const counted = results.filter((r) => !r.skipped);
const passed = counted.filter((r) => r.passed).length;
console.log(`\n${passed}/${counted.length} checks passed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
writeFileSync("qday-report.json", JSON.stringify(results, null, 2));
process.exit(passed === counted.length ? 0 : 1);
