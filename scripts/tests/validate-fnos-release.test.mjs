import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const validator = fileURLToPath(new URL("../validate-fnos-release.mjs", import.meta.url));
const digest = `sha256:${"a".repeat(64)}`;

function validCompose({ api = "", web = "", gateway = "" } = {}) {
  return `name: sag\nservices:\n  api:\n    image: ghcr.io/luoshuai990529/sag-api@${digest}\n    environment:\n      SAG_SECRET_KEY: 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\n${api}  web:\n    image: ghcr.io/luoshuai990529/sag-web@${digest}\n${web}  gateway:\n    image: nginx@${digest}\n${gateway}`;
}

async function fixture(t, contents) {
  const root = await mkdtemp(path.join(os.tmpdir(), "sag-fnos-release-"));
  const compose = path.join(root, "docker-compose.yml");
  await writeFile(compose, contents);
  t.after(async () => rm(root, { recursive: true, force: true }));
  return compose;
}

function validate(compose) {
  const result = spawnSync(process.execPath, [validator, compose], { encoding: "utf8" });
  if (result.error) throw result.error;
  return result;
}

test("accepts a digest-pinned release Compose with a strong API secret", async (t) => {
  const compose = await fixture(t, validCompose());
  const result = validate(compose);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /release Compose validation passed/);
});

test("rejects a latest image tag", async (t) => {
  const compose = await fixture(t, validCompose().replace(`ghcr.io/luoshuai990529/sag-api@${digest}`, "ghcr.io/luoshuai990529/sag-api:latest"));
  const result = validate(compose);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /latest tag/);
});

test("rejects Compose build instructions", async (t) => {
  const compose = await fixture(t, validCompose({ api: "    build: ./apps/api\n" }));
  const result = validate(compose);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must not define build/);
});

test("rejects a weak development secret", async (t) => {
  const compose = await fixture(t, validCompose().replace(/0123456789abcdef/g, "dev-insecure-secret-change-me-in-production-0123456789"));
  const result = validate(compose);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /strong SAG_SECRET_KEY/);
});

test("rejects an API host port", async (t) => {
  const compose = await fixture(t, validCompose({ api: "    ports:\n      - \"8000:8000\"\n" }));
  const result = validate(compose);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /api must not publish host ports/);
});

test("rejects a Web host port", async (t) => {
  const compose = await fixture(t, validCompose({ web: "    ports:\n      - \"3000:3000\"\n" }));
  const result = validate(compose);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /web must not publish host ports/);
});

test("rejects a non-digest image reference", async (t) => {
  const compose = await fixture(t, validCompose().replace(`nginx@${digest}`, "nginx:1.27-alpine"));
  const result = validate(compose);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must use an immutable sha256 digest/);
});
