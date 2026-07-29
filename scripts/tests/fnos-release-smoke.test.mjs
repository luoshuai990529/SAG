import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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

async function fakeTools(t, {
  nameOnlyStatus = "401",
  dockerFail = "",
  readiness = {},
  rootResponse = {},
  loginResponse = {},
} = {}) {
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
} else {
  const responses = JSON.parse(process.env.FAKE_HTTP_RESPONSES);
  const url = args.at(-1);
  const response = url.endsWith("/api/v1/system/ready")
    ? responses.readiness
    : url.endsWith("/login") ? responses.login : responses.root;
  const outputIndex = args.indexOf("--output");
  const headerIndex = args.indexOf("--dump-header");
  if (outputIndex >= 0) fs.writeFileSync(args[outputIndex + 1], response.body);
  if (headerIndex >= 0) fs.writeFileSync(args[headerIndex + 1], response.headers);
  process.stdout.write(String(response.status));
  if (response.stderr) process.stderr.write(response.stderr);
  if (response.exitCode) process.exit(response.exitCode);
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
      FAKE_HTTP_RESPONSES: JSON.stringify({
        readiness: {
          status: 200,
          headers: "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n",
          body: JSON.stringify({ status: "ready", db: true }),
          exitCode: 0,
          stderr: "",
          ...readiness,
        },
        root: {
          status: 307,
          headers: "HTTP/1.1 307 Temporary Redirect\r\nLocation: /login\r\n\r\n",
          body: "",
          exitCode: 0,
          stderr: "",
          ...rootResponse,
        },
        login: {
          status: 200,
          headers: "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\r\n",
          body: '<!DOCTYPE html><html><head><link href="/_next/static/css/app.css"></head><body>SAG</body></html>',
          exitCode: 0,
          stderr: "",
          ...loginResponse,
        },
      }),
      TMPDIR: root,
    },
    root,
  };
}

function invoke(tools, command = "smoke") {
  return spawnSync(process.execPath, [
    smoke, command,
    "--docker", tools.docker,
    ...(command === "smoke" ? ["--curl", tools.curl, "--api-image", apiImage, "--web-image", webImage] : []),
    ...(command === "smoke" ? ["--readiness-attempts", "1"] : []),
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
  assert.ok(curlCalls.filter((args) => !args.includes("--data")).every(
    (args) => args.includes("--dump-header") && !args.includes("--location"),
  ));
  const loginBodies = curlCalls.filter((args) => args.includes("--data")).map((args) => JSON.parse(args[args.indexOf("--data") + 1]));
  assert.deepEqual(loginBodies.map((body) => Object.keys(body).sort()), [
    ["name"],
    ["bootstrap_token", "name", "password"],
    ["name", "password"],
  ]);
  assert.ok(dockerCalls.some((args) => args[0] === "rm" && args.includes("sag-fnos-api-test-123") && args.includes("sag-fnos-web-test-123")));
  assert.ok(dockerCalls.some((args) => args[0] === "volume" && args[1] === "rm" && args.includes("sag-fnos-data-test-123")));
  assert.equal((await readdir(tools.root)).filter((name) => name.startsWith("sag-fnos-http-")).length, 0);
});

for (const [name, readiness, message] of [
  ["HTTP 204", { status: 204, headers: "HTTP/1.1 204 No Content\r\n\r\n", body: "" }, /readiness.*HTTP 200/i],
  ["HTTP redirect", { status: 302, headers: "HTTP/1.1 302 Found\r\nLocation: /login\r\n\r\n", body: "" }, /readiness.*HTTP 200/i],
  ["wrong status field", { body: JSON.stringify({ status: "starting", db: true }) }, /status.*ready/i],
  ["malformed JSON", { body: "{not-json" }, /readiness.*JSON/i],
  ["database false", { body: JSON.stringify({ status: "ready", db: false }) }, /db.*true/i],
  ["curl exit", { exitCode: 7, stderr: "connection refused", body: "" }, /readiness request failed/i],
  ["missing status", { status: "" }, /exact three-digit HTTP status/i],
  ["duplicate status", { status: "200200" }, /exact three-digit HTTP status/i],
  ["duplicate header status", { headers: "HTTP/1.1 200 OK\r\nHTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n" }, /exactly one HTTP status line/i],
  ["tab status", { headers: "HTTP/1.1\t200 OK\r\nContent-Type: application/json\r\n\r\n" }, /exactly one HTTP status line/i],
  ["status trailing tab", { headers: "HTTP/1.1 200 OK\t\r\nContent-Type: application/json\r\n\r\n" }, /exactly one HTTP status line/i],
  ["invalid HTTP version", { headers: "HTTP/9.9 200 OK\r\nContent-Type: application/json\r\n\r\n" }, /exactly one HTTP status line/i],
]) {
  test(`rejects API readiness with ${name}`, async (t) => {
    const tools = await fakeTools(t, { readiness });
    const result = invoke(tools);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, message);
    assert.equal((await readdir(tools.root)).filter((entry) => entry.startsWith("sag-fnos-http-")).length, 0);
  });
}

for (const [name, rootResponse, message] of [
  ["arbitrary 302", { status: 302, headers: "HTTP/1.1 302 Found\r\nLocation: /login\r\n\r\n" }, /Web root.*307 or 308/i],
  ["redirect loop", { headers: "HTTP/1.1 307 Temporary Redirect\r\nLocation: /\r\n\r\n" }, /Location.*\/login/i],
  ["wrong location", { headers: "HTTP/1.1 307 Temporary Redirect\r\nLocation: /chat\r\n\r\n" }, /Location.*\/login/i],
  ["empty query delimiter", { headers: "HTTP/1.1 307 Temporary Redirect\r\nLocation: /login?\r\n\r\n" }, /raw Location.*exactly \/login/i],
  ["empty hash delimiter", { headers: "HTTP/1.1 307 Temporary Redirect\r\nLocation: /login#\r\n\r\n" }, /raw Location.*exactly \/login/i],
  ["query hash delimiters", { headers: "HTTP/1.1 307 Temporary Redirect\r\nLocation: /login?#\r\n\r\n" }, /raw Location.*exactly \/login/i],
  ["encoded path", { headers: "HTTP/1.1 307 Temporary Redirect\r\nLocation: /%6cogin\r\n\r\n" }, /raw Location.*exactly \/login/i],
  ["open redirect", { headers: "HTTP/1.1 307 Temporary Redirect\r\nLocation: //evil.example/login\r\n\r\n" }, /raw Location.*exactly \/login/i],
  ["wrong host", { headers: "HTTP/1.1 307 Temporary Redirect\r\nLocation: http://evil.example/login\r\n\r\n" }, /raw Location.*exactly \/login/i],
  ["missing Location", { headers: "HTTP/1.1 307 Temporary Redirect\r\n\r\n" }, /exactly one Location/i],
  ["duplicate Location", { headers: "HTTP/1.1 307 Temporary Redirect\r\nLocation: /login\r\nLocation: /login\r\n\r\n" }, /exactly one Location/i],
  ["curl exit", { exitCode: 7, stderr: "connection refused" }, /Web root request failed/i],
  ["unexpected 200", { status: 200, headers: "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n", body: "<!doctype html>" }, /Web root.*307 or 308/i],
]) {
  test(`rejects Web root ${name}`, async (t) => {
    const tools = await fakeTools(t, { rootResponse });
    const result = invoke(tools);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, message);
  });
}

for (const [name, loginResponse, message] of [
  ["redirect", { status: 307, headers: "HTTP/1.1 307 Temporary Redirect\r\nLocation: /login\r\n\r\n", body: "" }, /Web login.*HTTP 200/i],
  ["wrong content type", { headers: "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n" }, /Content-Type.*text\/html/i],
  ["arbitrary body", { body: "<html><body>OK</body></html>" }, /Next.*HTML markers/i],
  ["empty body", { body: "" }, /Next.*HTML markers/i],
  ["marker in comment", { body: '<!doctype html><!-- <script src="/_next/static/x.js"></script> --><html><body>SAG</body></html>' }, /Next.*HTML markers/i],
  ["marker in unterminated comment", { body: '<!doctype html><!-- <script src="/_next/static/x.js"></script><html></html>' }, /Next.*HTML markers/i],
  ["marker in malformed comment close", { body: '<!doctype html><!-- <script src="/_next/static/x.js"></script> --!><html></html>' }, /Next.*HTML markers/i],
  ["comment spliced into asset path", { body: '<!doctype html><script src="/_next/sta<!--x-->tic/x.js"></script>' }, /Next.*HTML markers/i],
  ["comment spliced into tag name", { body: '<!doctype html><scr<!--x-->ipt src="/_next/static/x.js"></script>' }, /Next.*HTML markers/i],
  ["marker as text", { body: "<!doctype html><html><body>/_next/static/x.js</body></html>" }, /Next.*HTML markers/i],
  ["script-widget tag", { body: '<!doctype html><script-widget src="/_next/static/x.js"></script-widget>' }, /Next.*HTML markers/i],
  ["link-widget tag", { body: '<!doctype html><link-widget href="/_next/static/x.css">' }, /Next.*HTML markers/i],
  ["script href", { body: '<!doctype html><script href="/_next/static/x.js"></script>' }, /Next.*HTML markers/i],
  ["link src", { body: '<!doctype html><link src="/_next/static/x.css">' }, /Next.*HTML markers/i],
  ["data-src", { body: '<!doctype html><script data-src="/_next/static/x.js"></script>' }, /Next.*HTML markers/i],
  ["data-href", { body: '<!doctype html><link data-href="/_next/static/x.css">' }, /Next.*HTML markers/i],
  ["uppercase path", { body: '<!doctype html><script src="/_NEXT/static/x.js"></script>' }, /Next.*HTML markers/i],
  ["duplicate src nonnext then next", { body: '<!doctype html><script src="/other.js" src="/_next/static/x.js"></script>' }, /Next.*HTML markers/i],
  ["duplicate src next then nonnext", { body: '<!doctype html><script src="/_next/static/x.js" src="/other.js"></script>' }, /Next.*HTML markers/i],
  ["mixed-case duplicate href", { body: '<!doctype html><link HREF="/other.css" href="/_next/static/x.css">' }, /Next.*HTML markers/i],
  ["boolean SRC plus real src", { body: '<!doctype html><script SRC src="/_next/static/x.js"></script>' }, /Next.*HTML markers/i],
  ["unquoted src", { body: '<!doctype html><script src=/_next/static/x.js></script>' }, /Next.*HTML markers/i],
  ["unclosed relevant quote", { body: '<!doctype html><script src="/_next/static/x.js></script>' }, /Next.*HTML markers/i],
  ["unclosed tag", { body: '<!doctype html><script src="/_next/static/x.js"' }, /Next.*HTML markers/i],
  ["missing Content-Type", { headers: "HTTP/1.1 200 OK\r\n\r\n" }, /Content-Type.*text\/html/i],
  ["duplicate Content-Type", { headers: "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Type: text/html\r\n\r\n" }, /Content-Type.*text\/html/i],
  ["curl exit", { exitCode: 7, stderr: "connection refused" }, /Web login request failed/i],
]) {
  test(`rejects Web login ${name}`, async (t) => {
    const tools = await fakeTools(t, { loginResponse });
    const result = invoke(tools);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, message);
  });
}

test("accepts a real quoted Next script marker with CRLF headers", async (t) => {
  const tools = await fakeTools(t, {
    loginResponse: {
      headers: "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\r\n",
      body: '<!doctype html><html><body><script defer src="/_next/static/chunks/app.js"></script></body></html>',
    },
  });
  assert.equal(invoke(tools).status, 0);
});

test("accepts quoted greater-than text in an unrelated attribute", async (t) => {
  const tools = await fakeTools(t, {
    loginResponse: {
      body: '<!doctype html><script data-note="a > b" src="/_next/static/chunks/app.js"></script>',
    },
  });
  assert.equal(invoke(tools).status, 0);
});

test("ignores attribute-looking text inside another quoted value", async (t) => {
  const tools = await fakeTools(t, {
    loginResponse: {
      body: '<!doctype html><script data-x=\'src="/other.js"\' src="/_next/static/chunks/app.js"></script>',
    },
  });
  assert.equal(invoke(tools).status, 0);
});

test("skips a complete top-level comment and accepts a later real Next tag", async (t) => {
  const tools = await fakeTools(t, {
    loginResponse: {
      body: '<!doctype html><!-- <script src="/_next/static/fake.js"></script> --><script src="/_next/static/real.js"></script>',
    },
  });
  assert.equal(invoke(tools).status, 0);
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
