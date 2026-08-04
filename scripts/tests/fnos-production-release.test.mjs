import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const script = path.join(repoRoot, "scripts/release-fnos.mjs");

test("prepare records a global release input for the checked-out fnOS manifest", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sag-fnos-release-prepare-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const output = path.join(root, "release-input.json");
  const result = spawnSync(process.execPath, [
    script,
    "prepare",
    "--version", "1.4.0-fnos.6",
    "--channel", "global",
    "--candidate-run-id", "30798626087",
    "--output", output,
  ], { cwd: repoRoot, encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr);
});

test("prepare rejects a release request with an invalid channel", () => {
  const result = spawnSync(process.execPath, [
    script,
    "prepare",
    "--version", "1.4.0-fnos.6",
    "--channel", "mirror.example",
    "--candidate-run-id", "30798626087",
    "--output", path.join(os.tmpdir(), "sag-fnos-invalid-release-input.json"),
  ], { cwd: repoRoot, encoding: "utf8" });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /channel.*global.*cn/i);
});
