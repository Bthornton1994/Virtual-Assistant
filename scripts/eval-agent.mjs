/**
 * Deterministic agent reliability evaluation CLI.
 * No model calls, network, or production database access.
 *
 * Usage: node --experimental-strip-types scripts/eval-agent.mjs
 *        node --experimental-strip-types scripts/eval-agent.mjs --json
 *
 * Report generatedAt is the actual invocation time.
 * Evidence expiry uses DEFAULT_EVALUATION_CLOCK unless --evaluation-clock is set.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  agentEvalExitCode,
  runAgentEval,
  DEFAULT_EVALUATION_CLOCK,
} from "../src/lib/agent-eval/harness.ts";
import { MemoryTraceSink, setAgentTraceSink } from "../src/lib/agent-trace/sink.ts";

const args = process.argv.slice(2);
const argSet = new Set(args);
const jsonOnly = argSet.has("--json");
const writePath = (() => {
  const index = args.indexOf("--out");
  if (index === -1) return null;
  return args[index + 1] ?? null;
})();
const evaluationClock = (() => {
  const index = args.indexOf("--evaluation-clock");
  if (index === -1) return DEFAULT_EVALUATION_CLOCK;
  return args[index + 1] ?? DEFAULT_EVALUATION_CLOCK;
})();

const sink = new MemoryTraceSink();
setAgentTraceSink(sink);

const report = runAgentEval({
  evaluationClock,
  // generatedAt defaults to actual invocation time inside runAgentEval.
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
    `generatedAt: ${report.generatedAt}`,
    `evaluationClock: ${evaluationClock}`,
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
