import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const script = path.join(repoRoot, "scripts/fnos-registry-channel.mjs");
const digest = `sha256:${"a".repeat(64)}`;

function run(channel, api = `ghcr.io/luoshuai990529/sag-api@${digest}`) {
  return spawnSync(process.execPath, [
    script,
    "validate",
    "--channel", channel,
    "--api-image", api,
    "--web-image", `ghcr.io/luoshuai990529/sag-web@${digest}`,
    "--gateway-image", `docker.io/library/nginx:1.30.4-alpine@${digest}`,
  ], { cwd: repoRoot, encoding: "utf8" });
}

test("global channel accepts only SAG GHCR repositories and the reviewed Docker Hub gateway", () => {
  const result = run("global");
  assert.equal(result.status, 0, result.stderr);
});

test("global channel rejects an arbitrary registry even with a digest", () => {
  const result = run("global", `registry.example/sag-api@${digest}`);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /global.*api|approved/i);
});

test("cn channel is unavailable until a SAG-owned mirror is configured", () => {
  const result = run("cn");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cn.*mirror|mirror.*provisioned/i);
});
