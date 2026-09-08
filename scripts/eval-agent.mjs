/**
 * Deterministic agent reliability evaluation CLI.
 * No model calls, network, or production database access.
 *
 * Usage: node --experimental-strip-types scripts/eval-agent.mjs
 *        node --experimental-strip-types scripts/eval-agent.mjs --json
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  agentEvalExitCode,
  runAgentEval,
} from "../src/lib/agent-eval/harness.ts";
import { MemoryTraceSink, setAgentTraceSink } from "../src/lib/agent-trace/sink.ts";

const args = new Set(process.argv.slice(2));
const jsonOnly = args.has("--json");
const writePath = (() => {
  const index = process.argv.indexOf("--out");
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
})();

const sink = new MemoryTraceSink();
setAgentTraceSink(sink);

const report = runAgentEval({
  generatedAt: "2026-09-08T16:00:00.000Z",
});

const payload = JSON.stringify(report, null, 2);

if (writePath) {
  writeFileSync(resolve(writePath), payload + "\n", "utf8");
}

if (jsonOnly) {
  process.stdout.write(payload + "\n");
} else {
  const lines = [
    `agent-reliability-eval ${report.policyVersion}`,
    `cases: ${report.summary.passed}/${report.summary.total} passed`,
    `security fixture failures: ${report.summary.securityCaseFailures}`,
    `measures: policy/authority/evidence/approval/lifecycle (not model quality)`,
  ];
  for (const result of report.cases) {
    const mark = result.pass ? "PASS" : "FAIL";
    lines.push(`  [${mark}] ${result.caseId}`);
    for (const reason of result.failureReasons) {
      lines.push(`         - ${reason}`);
    }
  }
  lines.push(`trace events captured: ${sink.list().length} (in-memory only)`);
  process.stdout.write(lines.join("\n") + "\n");
}

setAgentTraceSink(null);
process.exit(agentEvalExitCode(report));
