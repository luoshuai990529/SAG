import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const smoke = path.join(repoRoot, "scripts/smoke-fnos-release-images.mjs");
const apiDigest = `sha256:${"a".repeat(64)}`;
const webDigest = `sha256:${"b".repeat(64)}`;
const apiImage = `ghcr.io/luoshuai990529/sag-api@${apiDigest}`;
const webImage = `ghcr.io/luoshuai990529/sag-web@${webDigest}`;

async function fakeTools(t, { nameOnlyStatus = "401", dockerFail = "" } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "sag-fnos-digest-smoke-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const docker = path.join(root, "docker");
  const curl = path.join(root, "curl");
  const dockerLog = path.join(root, "docker.jsonl");
  const curlLog = path.join(root, "curl.jsonl");
  await writeFile(docker, `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_DOCKER_LOG, JSON.stringify(args) + "\\n");
if (process.env.FAKE_DOCKER_FAIL && args.join(" ").includes(process.env.FAKE_DOCKER_FAIL)) {
  process.stderr.write("injected docker failure\\n"); process.exit(9);
}
if (args[0] === "volume" && args[1] === "create") process.stdout.write(args.at(-1) + "\\n");
else if (args[0] === "run") process.stdout.write("container-id\\n");
process.exit(0);
`);
  await writeFile(curl, `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_CURL_LOG, JSON.stringify(args) + "\\n");
const dataIndex = args.indexOf("--data");
if (dataIndex >= 0) {
  const body = JSON.parse(args[dataIndex + 1]);
  process.stdout.write(body.password ? "200" : process.env.FAKE_NAME_ONLY_STATUS);
}
process.exit(0);
`);
  await chmod(docker, 0o755);
  await chmod(curl, 0o755);
  return {
    docker,
    curl,
    dockerLog,
    curlLog,
    env: {
      FAKE_DOCKER_LOG: dockerLog,
      FAKE_CURL_LOG: curlLog,
      FAKE_NAME_ONLY_STATUS: nameOnlyStatus,
      FAKE_DOCKER_FAIL: dockerFail,
    },
  };
}

function invoke(tools, command = "smoke") {
  return spawnSync(process.execPath, [
    smoke, command,
    "--docker", tools.docker,
    ...(command === "smoke" ? ["--curl", tools.curl, "--api-image", apiImage, "--web-image", webImage] : []),
    "--scope", "test-123",
  ], { cwd: repoRoot, encoding: "utf8", env: { ...process.env, ...tools.env } });
}

async function jsonLines(file) {
  return (await readFile(file, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse);
}

test("smokes only the captured API/Web digest references with ephemeral password auth data", async (t) => {
  const tools = await fakeTools(t);
  const result = invoke(tools);
  assert.equal(result.status, 0, result.stderr);

  const dockerCalls = await jsonLines(tools.dockerLog);
  const pulls = dockerCalls.filter(([command]) => command === "pull");
  assert.deepEqual(pulls, [
    ["pull", "--platform", "linux/amd64", apiImage],
    ["pull", "--platform", "linux/amd64", webImage],
  ]);
  const runs = dockerCalls.filter(([command]) => command === "run");
  assert.equal(runs.length, 2);
  assert.equal(runs[0].at(-1), apiImage);
  assert.equal(runs[1].at(-1), webImage);
  assert.deepEqual(runs[0].slice(1, 3), ["--platform", "linux/amd64"]);
  assert.deepEqual(runs[1].slice(1, 3), ["--platform", "linux/amd64"]);
  assert.ok(runs[0].includes("SAG_AUTH_MODE=password"));
  assert.ok(runs[0].includes("type=volume,source=sag-fnos-data-test-123,target=/data"));
  const secret = runs[0].find((value) => value.startsWith("SAG_SECRET_KEY="))?.split("=")[1];
  const bootstrap = runs[0].find((value) => value.startsWith("SAG_AUTH_BOOTSTRAP_TOKEN="))?.split("=")[1];
  assert.match(secret ?? "", /^[a-f0-9]{64}$/);
  assert.match(bootstrap ?? "", /^[a-f0-9]{64}$/);
  assert.notEqual(secret, bootstrap);
  assert.doesNotMatch(JSON.stringify(dockerCalls), /staging-fnos|sag-api-smoke|sag-web-smoke|buildx|build-push/);

  const curlCalls = await jsonLines(tools.curlLog);
  assert.ok(curlCalls.some((args) => args.at(-1).endsWith("/api/v1/system/ready")));
  assert.ok(curlCalls.some((args) => args.at(-1).endsWith("/")));
  assert.ok(curlCalls.some((args) => args.at(-1).endsWith("/login")));
  const loginBodies = curlCalls.filter((args) => args.includes("--data")).map((args) => JSON.parse(args[args.indexOf("--data") + 1]));
  assert.deepEqual(loginBodies.map((body) => Object.keys(body).sort()), [
    ["name"],
    ["bootstrap_token", "name", "password"],
    ["name", "password"],
  ]);
  assert.ok(dockerCalls.some((args) => args[0] === "rm" && args.includes("sag-fnos-api-test-123") && args.includes("sag-fnos-web-test-123")));
  assert.ok(dockerCalls.some((args) => args[0] === "volume" && args[1] === "rm" && args.includes("sag-fnos-data-test-123")));
});

test("fails closed when an exact digest pull fails and still attempts cleanup", async (t) => {
  const tools = await fakeTools(t, { dockerFail: `pull --platform linux/amd64 ${apiImage}` });
  const result = invoke(tools);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /exact API digest pull failed/i);
  const dockerCalls = await jsonLines(tools.dockerLog);
  assert.equal(dockerCalls.filter(([command]) => command === "run").length, 0);
  assert.ok(dockerCalls.some((args) => args[0] === "rm"));
  assert.ok(dockerCalls.some((args) => args[0] === "volume" && args[1] === "rm"));
});

test("fails closed on incorrect name-only auth and still cleans containers and volume", async (t) => {
  const tools = await fakeTools(t, { nameOnlyStatus: "200" });
  const result = invoke(tools);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /name-only login.*401/i);
  const dockerCalls = await jsonLines(tools.dockerLog);
  assert.ok(dockerCalls.some((args) => args[0] === "rm"));
  assert.ok(dockerCalls.some((args) => args[0] === "volume" && args[1] === "rm"));
});

test("fails when cleanup cannot remove smoke resources", async (t) => {
  const tools = await fakeTools(t, { dockerFail: "rm --force" });
  const result = invoke(tools);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /container cleanup failed/i);
  const dockerCalls = await jsonLines(tools.dockerLog);
  assert.ok(dockerCalls.some((args) => args[0] === "volume" && args[1] === "rm"));
});
