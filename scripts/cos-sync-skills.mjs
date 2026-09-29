#!/usr/bin/env node
/**
 * Sync canonical in-repo skills to the Claude mirror.
 *
 * Adapted from the sync-skills helper in steipete/agent-scripts at
 * 3f8c6a33f911818b72936248384e7a71b4f1d971 (MIT). See THIRD_PARTY/NOTICE.
 *
 * Canonical: <repo>/.agents/skills
 * Mirror:    <repo>/.claude/skills
 * Managed:   cos-* and test-audit
 *
 * Idempotent. --dry-run writes nothing. Real files and directories are never
 * overwritten. Stale symlinks whose targets sit inside the canonical root are
 * removed. Skill names that escape either root are refused before any write.
 * This script does not touch a home directory, an external identity, or model
 * routing.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = path.resolve(SCRIPT_DIR, "..");

export function isSafeSkillName(name) {
  return typeof name === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) && !name.includes("..");
}

export function isManagedSkillName(name) {
  return name === "test-audit" || (isSafeSkillName(name) && name.startsWith("cos-"));
}

/**
 * @param {string} root
 * @returns {{ ok: true, path: string } | { ok: false, error: string }}
 */
function resolveRoot(root) {
  const absolute = path.resolve(root);
  if (absolute.includes("\0")) return { ok: false, error: `refusing path: ${root}` };
  if (fs.existsSync(absolute)) {
    const real = fs.realpathSync(absolute);
    return { ok: true, path: real };
  }
  const parent = path.dirname(absolute);
  if (!fs.existsSync(parent)) return { ok: false, error: `parent does not exist: ${parent}` };
  return { ok: true, path: path.join(fs.realpathSync(parent), path.basename(absolute)) };
}

function insideRoot(root, candidate) {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function listFiles(dir) {
  /** @type {{ rel: string, type: "file" | "link", payload: string | Buffer }[]} */
  const out = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      const rel = path.relative(dir, full);
      if (entry.isSymbolicLink()) {
        out.push({ rel, type: "link", payload: fs.readlinkSync(full) });
      } else if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        out.push({ rel, type: "file", payload: fs.readFileSync(full) });
      }
    }
  };
  walk(dir);
  out.sort((a, b) => a.rel.localeCompare(b.rel));
  return out;
}

function treesEqual(leftDir, rightDir) {
  const left = listFiles(leftDir);
  const right = listFiles(rightDir);
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i].rel !== right[i].rel || left[i].type !== right[i].type) return false;
    if (left[i].type === "file" && right[i].type === "file") {
      if (!Buffer.isBuffer(left[i].payload) || !Buffer.isBuffer(right[i].payload)) return false;
      if (!left[i].payload.equals(right[i].payload)) return false;
    } else if (left[i].payload !== right[i].payload) {
      return false;
    }
  }
  return true;
}

function linkPointsInsideSource(linkPath, sourceRoot) {
  let raw;
  try {
    raw = fs.readlinkSync(linkPath);
  } catch {
    return false;
  }
  const resolved = path.resolve(path.dirname(linkPath), raw);
  return insideRoot(sourceRoot, resolved);
}

/**
 * @param {{
 *   sourceRoot?: string,
 *   destRoot?: string,
 *   dryRun?: boolean,
 *   names?: readonly string[] | null,
 * }} [options]
 */
export function syncSkills(options = {}) {
  const dryRun = options.dryRun === true;
  const sourceResolved = resolveRoot(options.sourceRoot ?? path.join(DEFAULT_REPO_ROOT, ".agents", "skills"));
  const destResolved = resolveRoot(options.destRoot ?? path.join(DEFAULT_REPO_ROOT, ".claude", "skills"));
  if (!sourceResolved.ok) return fail(2, sourceResolved.error);
  if (!destResolved.ok) return fail(2, destResolved.error);
  const sourceRoot = sourceResolved.path;
  const destRoot = destResolved.path;
  if (!fs.existsSync(sourceRoot) || !fs.statSync(sourceRoot).isDirectory()) {
    return fail(2, `source root is not a directory: ${sourceRoot}`);
  }

  /** @type {string[]} */
  const names = [];
  if (options.names) {
    for (const name of options.names) {
      if (!isSafeSkillName(name) || !isManagedSkillName(name)) {
        return fail(2, `refusing skill name: ${String(name)}`);
      }
      names.push(name);
    }
  } else {
    for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
      if (!isManagedSkillName(entry.name)) continue;
      const skillFile = path.join(sourceRoot, entry.name, "SKILL.md");
      if (fs.existsSync(skillFile)) names.push(entry.name);
    }
  }
  names.sort();

  for (const name of names) {
    const sourcePath = path.resolve(sourceRoot, name);
    if (!insideRoot(sourceRoot, sourcePath) || path.dirname(sourcePath) !== sourceRoot) {
      return fail(2, `refusing skill name: ${name}`);
    }
    if (!fs.existsSync(sourcePath)) return fail(2, `missing skill: ${name}`);
    const realSource = fs.realpathSync(sourcePath);
    if (!insideRoot(sourceRoot, realSource)) {
      return fail(2, `skill path escapes source root: ${name}`);
    }
    const skillFile = path.join(realSource, "SKILL.md");
    if (!fs.existsSync(skillFile) || !fs.statSync(skillFile).isFile()) {
      return fail(2, `missing SKILL.md: ${name}`);
    }
    const destPath = path.resolve(destRoot, name);
    if (!insideRoot(destRoot, destPath) || path.dirname(destPath) !== destRoot) {
      return fail(2, `refusing destination: ${name}`);
    }
  }

  /** @type {string[]} */
  const changes = [];
  /** @type {string[]} */
  const conflicts = [];
  /** @type {string[]} */
  const notes = [];
  /** @type {{ name: string, sourcePath: string, destPath: string, relativeTarget: string }[]} */
  const links = [];

  for (const name of names) {
    const sourcePath = fs.realpathSync(path.resolve(sourceRoot, name));
    const destPath = path.resolve(destRoot, name);
    const relativeTarget = path.relative(path.dirname(destPath), sourcePath);
    let listed = null;
    try {
      listed = fs.lstatSync(destPath);
    } catch (error) {
      if (!error || error.code !== "ENOENT") {
        return fail(2, `cannot inspect destination: ${destPath}`);
      }
    }
    if (!listed) {
      links.push({ name, sourcePath, destPath, relativeTarget });
      changes.push(`${dryRun ? "would-link" : "link"} ${destPath} -> ${relativeTarget}`);
      continue;
    }
    if (listed.isSymbolicLink()) {
      const current = fs.readlinkSync(destPath);
      const resolved = path.resolve(path.dirname(destPath), current);
      if (current === relativeTarget || resolved === sourcePath) {
        notes.push(`up to date ${name}`);
        continue;
      }
      if (linkPointsInsideSource(destPath, sourceRoot)) {
        links.push({ name, sourcePath, destPath, relativeTarget });
        changes.push(`${dryRun ? "would-retarget" : "retarget"} ${destPath} -> ${relativeTarget}`);
        continue;
      }
      conflicts.push(`link destination preserved: ${destPath}`);
      continue;
    }
    if (listed.isDirectory() && treesEqual(sourcePath, destPath)) {
      notes.push(`real destination already matches: ${destPath}`);
      continue;
    }
    conflicts.push(`real destination preserved: ${destPath}`);
  }

  /** @type {string[]} */
  const prunes = [];
  if (!options.names && fs.existsSync(destRoot)) {
    const desired = new Set(names);
    for (const entry of fs.readdirSync(destRoot, { withFileTypes: true })) {
      if (!isManagedSkillName(entry.name) || desired.has(entry.name)) continue;
      const destPath = path.resolve(destRoot, entry.name);
      if (!entry.isSymbolicLink()) {
        notes.push(`preserved real entry: ${destPath}`);
        continue;
      }
      if (!linkPointsInsideSource(destPath, sourceRoot)) {
        notes.push(`preserved foreign link: ${destPath}`);
        continue;
      }
      prunes.push(destPath);
      changes.push(`${dryRun ? "would-prune" : "prune"} stale link ${destPath}`);
    }
  }

  if (!dryRun) {
    if (links.length > 0 || prunes.length > 0) fs.mkdirSync(destRoot, { recursive: true });
    for (const link of links) {
      if (fs.existsSync(link.destPath) || fs.lstatSync(link.destPath, { throwIfNoEntry: false })) {
        const current = fs.lstatSync(link.destPath);
        if (!current.isSymbolicLink()) {
          conflicts.push(`real destination preserved: ${link.destPath}`);
          continue;
        }
        fs.unlinkSync(link.destPath);
      }
      fs.symlinkSync(link.relativeTarget, link.destPath);
    }
    for (const destPath of prunes) {
      const current = fs.lstatSync(destPath, { throwIfNoEntry: false });
      if (current && current.isSymbolicLink() && linkPointsInsideSource(destPath, sourceRoot)) {
        fs.unlinkSync(destPath);
      }
    }
  }

  const exitCode = conflicts.length > 0 ? 1 : 0;
  return {
    ok: exitCode === 0,
    exitCode,
    changes,
    conflicts,
    notes,
    managed: names.length,
    error: null,
  };
}

function fail(exitCode, error) {
  return {
    ok: false,
    exitCode,
    changes: [],
    conflicts: [],
    notes: [],
    managed: 0,
    error,
  };
}

function printHelp() {
  console.log(`usage: node scripts/cos-sync-skills.mjs [--dry-run] [--source dir] [--dest dir] [--name skill]

Canonical skills default to <repo>/.agents/skills.
The mirror defaults to <repo>/.claude/skills.
Managed names are cos-* and test-audit.
--dry-run reports actions and writes nothing.
Real destinations are preserved. Stale managed symlinks are pruned.
Names that escape a root are refused.`);
}

/**
 * @param {string[]} argv
 */
export function parseSyncArgs(argv) {
  /** @type {{ dryRun: boolean, sourceRoot: string | null, destRoot: string | null, names: string[] | null, help: boolean }} */
  const opts = { dryRun: false, sourceRoot: null, destRoot: null, names: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help") {
      if (argv.length !== 1) return { ok: false, error: "unknown argument with --help" };
      opts.help = true;
      return { ok: true, opts };
    }
    if (arg === "--dry-run") {
      opts.dryRun = true;
      continue;
    }
    if (arg === "--source" || arg === "--dest" || arg === "--name") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) return { ok: false, error: `missing value for ${arg}` };
      i += 1;
      if (arg === "--source") opts.sourceRoot = value;
      else if (arg === "--dest") opts.destRoot = value;
      else {
        opts.names ??= [];
        opts.names.push(value);
      }
      continue;
    }
    return { ok: false, error: `unknown argument: ${arg}` };
  }
  return { ok: true, opts };
}

function render(report) {
  const lines = [];
  if (report.error) lines.push(report.error);
  lines.push(...report.changes);
  for (const conflict of report.conflicts) lines.push(`conflict: ${conflict}`);
  if (report.changes.length === 0 && report.conflicts.length === 0 && !report.error) {
    lines.push(`skills mirror up to date (${report.managed} managed skill(s)); changes=0`);
  }
  return lines;
}

function main(argv) {
  const parsed = parseSyncArgs(argv);
  if (!parsed.ok) {
    console.error(parsed.error);
    return 2;
  }
  if (parsed.opts.help) {
    printHelp();
    return 0;
  }
  const report = syncSkills({
    dryRun: parsed.opts.dryRun,
    sourceRoot: parsed.opts.sourceRoot ?? undefined,
    destRoot: parsed.opts.destRoot ?? undefined,
    names: parsed.opts.names,
  });
  const lines = render(report);
  const sink = report.exitCode === 0 ? console.log : console.error;
  for (const line of lines) sink(line);
  return report.exitCode;
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedDirectly) {
  process.exitCode = main(process.argv.slice(2));
}
