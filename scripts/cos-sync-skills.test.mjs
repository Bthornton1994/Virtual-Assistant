import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { syncSkills } from "./cos-sync-skills.mjs";
import { validateSkills } from "./cos-validate-skills.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const syncScript = path.join(repoRoot, "scripts/cos-sync-skills.mjs");
const validateScript = path.join(repoRoot, "scripts/cos-validate-skills.mjs");

function withTmp(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cos-skills-"));
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function skillText(name, body = "See [note](./NOTE.md).\n") {
  return `---\nname: ${name}\ndescription: Exercise the ${name} skill.\n---\n\n# ${name}\n\n${body}`;
}

function writeSkillPair(repo, name, body) {
  for (const root of [".agents", ".claude"]) {
    const dir = path.join(repo, root, "skills", name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "SKILL.md"), skillText(name, body));
    fs.writeFileSync(path.join(dir, "NOTE.md"), "note\n");
  }
}

test("dry-run is idempotent and writes nothing when the mirror is missing", () => {
  withTmp((root) => {
    const source = path.join(root, "source");
    const dest = path.join(root, "dest");
    fs.mkdirSync(path.join(source, "cos-one"), { recursive: true });
    fs.writeFileSync(path.join(source, "cos-one", "SKILL.md"), skillText("cos-one"));
    const first = syncSkills({ sourceRoot: source, destRoot: dest, dryRun: true });
    const second = syncSkills({ sourceRoot: source, destRoot: dest, dryRun: true });
    assert.equal(first.exitCode, 0);
    assert.equal(second.exitCode, 0);
    assert.equal(first.changes.length, 1);
    assert.match(first.changes[0], /^would-link /);
    assert.deepEqual(second.changes, first.changes);
    assert.equal(fs.existsSync(dest), false);
  });
});

test("apply is idempotent and a second run reports no changes", () => {
  withTmp((root) => {
    const source = path.join(root, "source");
    const dest = path.join(root, "dest");
    fs.mkdirSync(path.join(source, "cos-one"), { recursive: true });
    fs.writeFileSync(path.join(source, "cos-one", "SKILL.md"), skillText("cos-one"));
    const created = syncSkills({ sourceRoot: source, destRoot: dest, dryRun: false });
    const again = syncSkills({ sourceRoot: source, destRoot: dest, dryRun: false });
    assert.equal(created.changes.length, 1);
    assert.equal(again.changes.length, 0);
    assert.equal(again.exitCode, 0);
    assert.equal(fs.lstatSync(path.join(dest, "cos-one")).isSymbolicLink(), true);
    const dry = syncSkills({ sourceRoot: source, destRoot: dest, dryRun: true });
    assert.deepEqual(dry.changes, []);
  });
});

test("preserves a differing real destination and reports the conflict", () => {
  withTmp((root) => {
    const source = path.join(root, "source");
    const dest = path.join(root, "dest");
    fs.mkdirSync(path.join(source, "cos-one"), { recursive: true });
    fs.writeFileSync(path.join(source, "cos-one", "SKILL.md"), skillText("cos-one"));
    const realDir = path.join(dest, "cos-one");
    fs.mkdirSync(realDir, { recursive: true });
    const realFile = path.join(realDir, "SKILL.md");
    fs.writeFileSync(realFile, "local edits stay\n");
    const before = fs.readFileSync(realFile);
    const report = syncSkills({ sourceRoot: source, destRoot: dest, dryRun: false });
    const again = syncSkills({ sourceRoot: source, destRoot: dest, dryRun: true });
    assert.equal(report.exitCode, 1);
    assert.equal(report.conflicts.length, 1);
    assert.match(report.conflicts[0], /real destination preserved/);
    assert.equal(again.exitCode, 1);
    assert.deepEqual(fs.readFileSync(realFile), before);
    assert.equal(fs.lstatSync(realDir).isSymbolicLink(), false);
  });
});

test("leaves a matching real mirror untouched", () => {
  withTmp((root) => {
    const source = path.join(root, "source");
    const dest = path.join(root, "dest", "cos-one");
    const text = skillText("cos-one");
    fs.mkdirSync(path.join(source, "cos-one"), { recursive: true });
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(source, "cos-one", "SKILL.md"), text);
    fs.writeFileSync(path.join(dest, "SKILL.md"), text);
    const report = syncSkills({ sourceRoot: source, destRoot: path.join(root, "dest"), dryRun: true });
    assert.equal(report.exitCode, 0);
    assert.deepEqual(report.changes, []);
    assert.equal(fs.lstatSync(dest).isSymbolicLink(), false);
    assert.equal(fs.readFileSync(path.join(dest, "SKILL.md"), "utf8"), text);
  });
});

test("refuses a skill name that escapes the destination root", () => {
  withTmp((root) => {
    const source = path.join(root, "source");
    const dest = path.join(root, "dest");
    fs.mkdirSync(source, { recursive: true });
    const outside = path.resolve(dest, "..", "outside");
    const report = syncSkills({ sourceRoot: source, destRoot: dest, names: ["../outside"] });
    assert.equal(report.exitCode, 2);
    assert.match(report.error ?? "", /refusing skill name/);
    assert.equal(fs.existsSync(outside), false);
    assert.equal(fs.existsSync(dest), false);
  });
});

test("refuses a canonical skill whose real path escapes the source root", () => {
  withTmp((root) => {
    const source = path.join(root, "source");
    const dest = path.join(root, "dest");
    const outside = path.join(root, "outside");
    fs.mkdirSync(path.join(outside, "nested"), { recursive: true });
    fs.writeFileSync(path.join(outside, "nested", "SKILL.md"), skillText("cos-escape"));
    fs.mkdirSync(source, { recursive: true });
    fs.symlinkSync(path.join(outside, "nested"), path.join(source, "cos-escape"));
    const report = syncSkills({ sourceRoot: source, destRoot: dest, dryRun: false });
    assert.equal(report.exitCode, 2);
    assert.match(report.error ?? "", /escapes source root/);
    assert.equal(fs.existsSync(path.join(dest, "cos-escape")), false);
  });
});

test("prunes stale managed symlinks and preserves foreign links and real files", () => {
  withTmp((root) => {
    const source = path.join(root, "source");
    const dest = path.join(root, "dest");
    fs.mkdirSync(path.join(source, "cos-live"), { recursive: true });
    fs.writeFileSync(path.join(source, "cos-live", "SKILL.md"), skillText("cos-live"));
    fs.mkdirSync(dest, { recursive: true });
    const stale = path.join(dest, "cos-old");
    fs.symlinkSync(path.relative(dest, path.join(source, "cos-old")), stale);
    const foreignDir = path.join(root, "foreign");
    fs.mkdirSync(foreignDir, { recursive: true });
    const foreign = path.join(dest, "cos-foreign");
    fs.symlinkSync(foreignDir, foreign);
    const realNotes = path.join(dest, "cos-notes");
    fs.mkdirSync(realNotes, { recursive: true });
    fs.writeFileSync(path.join(realNotes, "SKILL.md"), "keep me\n");

    const preview = syncSkills({ sourceRoot: source, destRoot: dest, dryRun: true });
    assert.match(preview.changes.join("\n"), /would-prune/);
    assert.equal(fs.lstatSync(stale).isSymbolicLink(), true);

    const applied = syncSkills({ sourceRoot: source, destRoot: dest, dryRun: false });
    assert.equal(applied.exitCode, 0);
    assert.equal(fs.existsSync(stale), false);
    assert.equal(fs.lstatSync(foreign).isSymbolicLink(), true);
    assert.equal(fs.readFileSync(path.join(realNotes, "SKILL.md"), "utf8"), "keep me\n");
    assert.equal(fs.lstatSync(path.join(dest, "cos-live")).isSymbolicLink(), true);

    const second = syncSkills({ sourceRoot: source, destRoot: dest, dryRun: false });
    assert.deepEqual(second.changes, []);
  });
});

test("validator accepts a mirrored skill and ignores unrelated trees", () => {
  withTmp((root) => {
    writeSkillPair(root, "cos-one", "See [note](./NOTE.md).\n");
    const ignored = path.join(root, ".claude", "skills", "better-ui");
    fs.mkdirSync(ignored, { recursive: true });
    fs.writeFileSync(path.join(ignored, "SKILL.md"), "no front matter\n[missing](./nope.md)\n");
    const result = validateSkills({ repoRoot: root });
    assert.equal(result.ok, true, result.errors.join("\n"));
    assert.equal(result.files.length, 2);
  });
});

test("validator reports missing description, broken refs, path escape, and mirror drift", () => {
  withTmp((root) => {
    const agents = path.join(root, ".agents", "skills", "cos-one");
    const claude = path.join(root, ".claude", "skills", "cos-one");
    fs.mkdirSync(agents, { recursive: true });
    fs.mkdirSync(claude, { recursive: true });
    const bad = `---\nname: cos-one\ndescription:\n---\n\n[gone](./missing.md)\n[out](../../../../../../etc/passwd)\n`;
    fs.writeFileSync(path.join(agents, "SKILL.md"), bad);
    fs.writeFileSync(path.join(claude, "SKILL.md"), `${bad}\nextra\n`);
    const result = validateSkills({ repoRoot: root });
    assert.equal(result.ok, false);
    const joined = result.errors.join("\n");
    assert.match(joined, /missing non-empty string field: description/);
    assert.match(joined, /broken relative ref/);
    assert.match(joined, /escapes the repository/);
    assert.match(joined, /mirror differs/);
  });
});

test("repo skill mirror validates and dry-run sync reports no changes twice", () => {
  const validated = validateSkills({ repoRoot });
  assert.equal(validated.ok, true, validated.errors.join("\n"));
  assert.ok(validated.files.length >= 2);

  const source = path.join(repoRoot, ".agents", "skills");
  const dest = path.join(repoRoot, ".claude", "skills");
  const first = syncSkills({ sourceRoot: source, destRoot: dest, dryRun: true });
  const second = syncSkills({ sourceRoot: source, destRoot: dest, dryRun: true });
  assert.equal(first.exitCode, 0);
  assert.deepEqual(first.changes, []);
  assert.deepEqual(second.changes, []);
  assert.deepEqual(second.conflicts, []);

  const cli1 = spawnSync(process.execPath, [syncScript, "--dry-run"], { encoding: "utf8" });
  const cli2 = spawnSync(process.execPath, [syncScript, "--dry-run"], { encoding: "utf8" });
  assert.equal(cli1.status, 0, cli1.stderr);
  assert.equal(cli2.status, 0, cli2.stderr);
  assert.match(cli2.stdout, /changes=0/);
  assert.equal(cli1.stdout, cli2.stdout);

  const validateCli = spawnSync(process.execPath, [validateScript], { encoding: "utf8" });
  assert.equal(validateCli.status, 0, validateCli.stderr);
  assert.match(validateCli.stdout, /Validated \d+ skill\(s\)\./);
});
