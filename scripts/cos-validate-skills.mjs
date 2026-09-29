#!/usr/bin/env node
/**
 * Validate managed Delegation Cloud skills.
 *
 * Adapted from the validate-skills helper in steipete/agent-scripts at
 * 3f8c6a33f911818b72936248384e7a71b4f1d971 (MIT). See THIRD_PARTY/NOTICE.
 * This script checks in-repo dual roots only. It does not scan home-directory
 * skill trees or pre-existing UI skills.
 *
 * Canonical root: .agents/skills/<name>/SKILL.md
 * Mirror root:    .claude/skills/<name>/SKILL.md
 * Managed names:  cos-* and test-audit
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = path.resolve(SCRIPT_DIR, "..");

const LINK_PATTERN = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'))?\)/g;

export function isManagedSkillName(name) {
  return name === "test-audit" || (name.startsWith("cos-") && isSafeSkillName(name));
}

export function isSafeSkillName(name) {
  return typeof name === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) && !name.includes("..");
}

/**
 * @param {string} text
 * @returns {{ ok: true, data: Record<string, string> } | { ok: false, error: string }}
 */
export function parseFrontMatter(text) {
  if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) {
    return { ok: false, error: "front matter must start on the first line and close with ---" };
  }
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!match) {
    return { ok: false, error: "front matter must start on the first line and close with ---" };
  }
  const lines = match[1].split(/\r?\n/);
  /** @type {Record<string, string>} */
  const data = {};
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const header = /^([A-Za-z][A-Za-z0-9_-]*):[ \t]*(.*)$/.exec(line);
    if (!header) {
      return { ok: false, error: `front matter line is not a field: ${line}` };
    }
    const key = header[1];
    const rest = header[2];
    if (rest === ">" || rest === ">-" || rest === "|" || rest === "|-") {
      const folded = rest.startsWith(">");
      const block = [];
      i += 1;
      while (i < lines.length) {
        const next = lines[i];
        if (next === "") {
          block.push("");
          i += 1;
          continue;
        }
        if (!/^[ \t]/.test(next)) {
          i -= 1;
          break;
        }
        block.push(next.replace(/^[ \t]+/, ""));
        i += 1;
      }
      data[key] = folded ? block.join(" ").replace(/[ \t]+/g, " ").trim() : block.join("\n").trim();
      continue;
    }
    let value = rest.trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    data[key] = value;
  }
  return { ok: true, data };
}

function listManaged(root, label, errors) {
  /** @type {{ name: string, file: string }[]} */
  const found = [];
  if (!fs.existsSync(root)) return found;
  const rootReal = fs.realpathSync(root);
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!isManagedSkillName(entry.name)) continue;
    const dir = path.resolve(rootReal, entry.name);
    const rel = path.relative(rootReal, dir);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      errors.push(`${label}/${entry.name}: path escapes the skill root`);
      continue;
    }
    const file = path.join(dir, "SKILL.md");
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      errors.push(`${label}/${entry.name}: missing SKILL.md`);
      continue;
    }
    found.push({ name: entry.name, file });
  }
  found.sort((a, b) => a.name.localeCompare(b.name));
  return found;
}

function relativeRefError(repoRoot, skillFile, href) {
  const bare = href.split("#")[0].split("?")[0];
  if (bare === "") return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(bare) || bare.startsWith("//")) return null;
  let decoded = bare;
  try {
    decoded = decodeURIComponent(bare);
  } catch {
    return `broken relative ref ${href}`;
  }
  if (decoded.includes("\0")) return `broken relative ref ${href}`;
  const absolute = path.resolve(path.dirname(skillFile), decoded);
  const rel = path.relative(repoRoot, absolute);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    return `relative ref escapes the repository: ${href}`;
  }
  if (!fs.existsSync(absolute)) return `broken relative ref ${href}`;
  return null;
}

function validateOne(repoRoot, skill) {
  /** @type {string[]} */
  const errors = [];
  const text = fs.readFileSync(skill.file, "utf8");
  const parsed = parseFrontMatter(text);
  const display = path.relative(repoRoot, skill.file);
  if (!parsed.ok) {
    errors.push(`${display}: ${parsed.error}`);
    return errors;
  }
  for (const field of ["name", "description"]) {
    const value = parsed.data[field];
    if (typeof value !== "string" || value.trim() === "") {
      errors.push(`${display}: missing non-empty string field: ${field}`);
    }
  }
  if (parsed.data.name && parsed.data.name !== skill.name) {
    errors.push(`${display}: name ${parsed.data.name} does not match directory ${skill.name}`);
  }
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, "");
  for (const match of body.matchAll(LINK_PATTERN)) {
    const problem = relativeRefError(repoRoot, skill.file, match[1]);
    if (problem) errors.push(`${display}: ${problem}`);
  }
  return errors;
}

/**
 * @param {{ repoRoot?: string }} [options]
 */
export function validateSkills(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? DEFAULT_REPO_ROOT);
  /** @type {string[]} */
  const errors = [];
  const canonical = listManaged(path.join(repoRoot, ".agents", "skills"), ".agents/skills", errors);
  const mirror = listManaged(path.join(repoRoot, ".claude", "skills"), ".claude/skills", errors);
  const mirrorByName = new Map(mirror.map((skill) => [skill.name, skill]));
  const canonicalNames = new Set(canonical.map((skill) => skill.name));

  for (const skill of canonical) {
    errors.push(...validateOne(repoRoot, skill));
    const twin = mirrorByName.get(skill.name);
    if (!twin) {
      errors.push(`${skill.name}: missing .claude/skills mirror`);
      continue;
    }
    errors.push(...validateOne(repoRoot, twin));
    const left = fs.readFileSync(skill.file);
    const right = fs.readFileSync(twin.file);
    if (!left.equals(right)) {
      errors.push(`${skill.name}: .claude mirror differs from .agents canonical`);
    }
  }
  for (const skill of mirror) {
    if (!canonicalNames.has(skill.name)) {
      errors.push(`${skill.name}: mirror without .agents/skills canonical`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    files: [...canonical.map((skill) => skill.file), ...mirror.map((skill) => skill.file)],
  };
}

function printHelp() {
  console.log(`usage: node scripts/cos-validate-skills.mjs [--root dir]

Checks cos-* and test-audit skills only.
Requires name and description front matter, live relative refs, and identical
.agents (canonical) and .claude (mirror) copies.`);
}

function main(argv) {
  let repoRoot = DEFAULT_REPO_ROOT;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help") {
      printHelp();
      return 0;
    }
    if (arg === "--root") {
      const value = argv[i + 1];
      if (!value) {
        console.error("missing value for --root");
        return 2;
      }
      repoRoot = path.resolve(value);
      i += 1;
      continue;
    }
    console.error(`unknown argument: ${arg}`);
    return 2;
  }
  const result = validateSkills({ repoRoot });
  if (!result.ok) {
    console.error("Skill validation failed:");
    for (const error of result.errors) console.error(`- ${error}`);
    return 1;
  }
  console.log(`Validated ${result.files.length} skill(s).`);
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedDirectly) {
  process.exitCode = main(process.argv.slice(2));
}
