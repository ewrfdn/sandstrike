/**
 * SANDSTRIKE // island shoreline QUICK regression pass.
 *
 * Thin wrapper around scripts/shore-probe.mjs tuned for fast re-runs while the
 * island-shore changes are landing: top-down plan + 3 shoreline views + waterline
 * close-up + plan-shore + the full 8-bearing beach-walk probe (the actual
 * acceptance criteria). Wave strip / transparency correlation are skipped.
 *
 * Usage:
 *   node scripts/shore-verify.mjs
 *   OUT_DIR=shots/shore-verify node scripts/shore-verify.mjs
 *   GPU=0 node scripts/shore-verify.mjs        # force SwiftShader
 *
 * Exit code: 0 when the assertions pass, 1 otherwise.
 */
import { runProbe } from './shore-probe.mjs';

const report = await runProbe({
  quick: true,
  outDir: process.env.OUT_DIR || 'shots/shore-verify',
});

console.log(`[shore-verify] ${report.passed ? 'PASS' : 'FAIL'} -> ${report.outDir}/shore-probe.json`);
process.exit(report.passed ? 0 : 1);
