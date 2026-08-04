import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const script = path.join(repoRoot, "scripts/fnos-release-manifest.mjs");
const revision = "a".repeat(40);

function validManifest() {
  return {
    schema_version: 1,
    appname: "sag",
    version: "1.4.0-fnos.7",
    channel: "global",
    revision,
    candidate_tag: "fnos-candidate-1.4.0-fnos.7-aaaaaaaaaaaa",
    candidate_workflow: {
      run_id: "30798626087",
      url: "https://github.com/luoshuai990529/SAG/actions/runs/30798626087",
    },
    images: {
      api: `ghcr.io/luoshuai990529/sag-api@sha256:${"b".repeat(64)}`,
      web: `ghcr.io/luoshuai990529/sag-web@sha256:${"c".repeat(64)}`,
      gateway: `docker.io/library/nginx:1.30.4-alpine@sha256:${"d".repeat(64)}`,
    },
    fpk: { filename: "sag-1.4.0-fnos.7.fpk", sha256: "e".repeat(64) },
  };
}

async function withManifest(t, manifest) {
  const root = await mkdtemp(path.join(os.tmpdir(), "sag-fnos-release-manifest-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const input = path.join(root, "release-manifest.json");
  await writeFile(input, `${JSON.stringify(manifest)}\n`);
  return input;
}

function validate(input) {
  return spawnSync(process.execPath, [script, "validate", "--input", input], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

test("release manifest accepts a complete global immutable release record", async (t) => {
  const input = await withManifest(t, validManifest());
  const result = validate(input);

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), validManifest());
});

test("release manifest rejects mutable image tags and inconsistent identity fields", async (t) => {
  const manifest = validManifest();
  manifest.images.api = "ghcr.io/luoshuai990529/sag-api:1.4.0-fnos.7";
  manifest.candidate_tag = "fnos-candidate-1.4.0-fnos.6-aaaaaaaaaaaa";
  manifest.fpk.filename = "sag-1.4.0-fnos.8.fpk";
  const input = await withManifest(t, manifest);
  const result = validate(input);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /immutable|candidate tag|filename/i);
});

test("release manifest rejects a cn channel that still points at global registries", async (t) => {
  const manifest = validManifest();
  manifest.channel = "cn";
  const input = await withManifest(t, manifest);
  const result = validate(input);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cn.*mirror|mirror.*provisioned/i);
});
