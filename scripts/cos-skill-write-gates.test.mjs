import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseSyncArgs, syncSkills } from "./cos-sync-skills.mjs";
import { parseFrontMatter, validateSkills } from "./cos-validate-skills.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const validateScript = path.join(repoRoot, "scripts/cos-validate-skills.mjs");

function withTmp(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cos-skill-gates-"));
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function skillText(name, body = "See [note](./NOTE.md).\n") {
  return `---\nname: ${name}\ndescription: Exercise the ${name} skill.\n---\n\n# ${name}\n\n${body}`;
}

test("sync refuses a missing dest parent, a null-byte path, and a named skill without SKILL.md", () => {
  withTmp((root) => {
    const source = path.join(root, "source");
    fs.mkdirSync(path.join(source, "cos-one"), { recursive: true });
    fs.writeFileSync(path.join(source, "cos-one", "SKILL.md"), skillText("cos-one"));

    const missingParent = syncSkills({
      sourceRoot: source,
      destRoot: path.join(root, "nope", "dest"),
    });
    assert.equal(missingParent.exitCode, 2);
    assert.match(missingParent.error ?? "", /parent does not exist/);

    const nul = syncSkills({
      sourceRoot: `${source}\0nested`,
      destRoot: path.join(root, "dest"),
    });
    assert.equal(nul.exitCode, 2);
    assert.match(nul.error ?? "", /refusing path/);

    fs.mkdirSync(path.join(source, "cos-empty"), { recursive: true });
    const missingSkill = syncSkills({
      sourceRoot: source,
      destRoot: path.join(root, "dest"),
      names: ["cos-empty"],
    });
    assert.equal(missingSkill.exitCode, 2);
    assert.match(missingSkill.error ?? "", /missing SKILL.md/);
  });
});

test("sync retargets a managed symlink and leaves a foreign-target link alone", () => {
  withTmp((root) => {
    const source = path.join(root, "source");
    const dest = path.join(root, "dest");
    fs.mkdirSync(path.join(source, "cos-one"), { recursive: true });
    fs.mkdirSync(path.join(source, "cos-old"), { recursive: true });
    fs.writeFileSync(path.join(source, "cos-one", "SKILL.md"), skillText("cos-one"));
    fs.writeFileSync(path.join(source, "cos-old", "SKILL.md"), skillText("cos-old"));
    fs.mkdirSync(dest, { recursive: true });
    fs.symlinkSync(path.relative(dest, path.join(source, "cos-old")), path.join(dest, "cos-one"));

    const applied = syncSkills({ sourceRoot: source, destRoot: dest, names: ["cos-one"], dryRun: false });
    assert.equal(applied.exitCode, 0);
    assert.match(applied.changes.join("\n"), /retarget/);
    assert.equal(fs.readlinkSync(path.join(dest, "cos-one")), path.relative(dest, path.join(source, "cos-one")));

    const foreignDir = path.join(root, "foreign");
    fs.mkdirSync(foreignDir, { recursive: true });
    fs.unlinkSync(path.join(dest, "cos-one"));
    fs.symlinkSync(foreignDir, path.join(dest, "cos-one"));
    const preserved = syncSkills({ sourceRoot: source, destRoot: dest, names: ["cos-one"], dryRun: false });
    assert.equal(preserved.exitCode, 1);
    assert.match(preserved.conflicts.join("\n"), /link destination preserved/);
    assert.equal(fs.readlinkSync(path.join(dest, "cos-one")), foreignDir);
  });
});

test("validator reports a missing name and a missing mirror, and accepts titled or hash-only refs", () => {
  withTmp((root) => {
    const agents = path.join(root, ".agents", "skills", "cos-one");
    fs.mkdirSync(agents, { recursive: true });
    fs.writeFileSync(path.join(agents, "NOTE.md"), "note\n");
    fs.writeFileSync(
      path.join(agents, "SKILL.md"),
      `---\ndescription: Missing name.\n---\n\nSee [note](./NOTE.md "title") and [here](#anchor).\n`,
    );
    const missingName = validateSkills({ repoRoot: root });
    assert.equal(missingName.ok, false);
    const joined = missingName.errors.join("\n");
    assert.match(joined, /missing non-empty string field: name/);
    assert.match(joined, /missing \.claude\/skills mirror/);

    fs.writeFileSync(path.join(agents, "SKILL.md"), skillText("cos-one", "See [note](./NOTE.md \"title\") and [here](#anchor).\n"));
    const claude = path.join(root, ".claude", "skills", "cos-one");
    fs.mkdirSync(claude, { recursive: true });
    fs.writeFileSync(path.join(claude, "SKILL.md"), fs.readFileSync(path.join(agents, "SKILL.md")));
    fs.writeFileSync(path.join(claude, "NOTE.md"), "note\n");
    const ok = validateSkills({ repoRoot: root });
    assert.equal(ok.ok, true, ok.errors.join("\n"));
  });
});

test("front matter refuses a non-letter key and the CLI reports a failing --root", () => {
  assert.equal(parseFrontMatter("---\n1name: cos-one\ndescription: x\n---\n").ok, false);
  assert.match(parseFrontMatter("---\n1name: cos-one\ndescription: x\n---\n").error ?? "", /not a field/);

  withTmp((root) => {
    const agents = path.join(root, ".agents", "skills", "cos-one");
    fs.mkdirSync(agents, { recursive: true });
    fs.writeFileSync(path.join(agents, "SKILL.md"), "no front matter\n");
    const cli = spawnSync(process.execPath, [validateScript, "--root", root], { encoding: "utf8" });
    assert.equal(cli.status, 1);
    assert.match(cli.stderr, /Skill validation failed/);
  });

  const parsed = parseSyncArgs(["--dry-run", "--source", "/tmp/src", "--dest", "/tmp/dest", "--name", "cos-one"]);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.opts.dryRun, true);
    assert.equal(parsed.opts.sourceRoot, "/tmp/src");
    assert.equal(parsed.opts.destRoot, "/tmp/dest");
    assert.deepEqual(parsed.opts.names, ["cos-one"]);
  }
});
