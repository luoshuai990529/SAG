#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

const digest = "sha256:[a-f0-9]{64}";
const apiReference = new RegExp(`^ghcr\\.io/luoshuai990529/sag-api@${digest}$`);
const webReference = new RegExp(`^ghcr\\.io/luoshuai990529/sag-web@${digest}$`);

function fail(message) {
  throw new Error(`fnOS exact-digest smoke: ${message}`);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!command) fail("a command is required");
  const options = { command };
  for (let index = 0; index < rest.length; index += 2) {
    const name = rest[index];
    const value = rest[index + 1];
    if (!name?.startsWith("--") || !value || value.startsWith("--")) fail(`value required for ${name ?? "argument"}`);
    options[name.slice(2).replaceAll("-", "_")] = value;
  }
  return options;
}

function required(options, name) {
  if (!options[name]) fail(`--${name.replaceAll("_", "-")} is required`);
  return options[name];
}

function names(options) {
  const scope = required(options, "scope");
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(scope)) fail("--scope must contain only lowercase letters, digits, and hyphens");
  return {
    api: `sag-fnos-api-${scope}`,
    web: `sag-fnos-web-${scope}`,
    data: `sag-fnos-data-${scope}`,
  };
}

function execute(executable, args) {
  const result = spawnSync(executable, args, { encoding: "utf8" });
  if (result.error) fail(`could not run ${executable}: ${result.error.message}`);
  return result;
}

function requireSuccess(result, operation) {
  if (result.status !== 0) fail(`${operation} failed: ${(result.stderr || result.stdout).trim()}`);
  return result;
}

function docker(options, args, operation) {
  return requireSuccess(execute(required(options, "docker"), args), operation);
}

function cleanup(options) {
  const resource = names(options);
  const executable = required(options, "docker");
  const containers = execute(executable, ["rm", "--force", resource.api, resource.web]);
  const volume = execute(executable, ["volume", "rm", "--force", resource.data]);
  const containerError = (containers.stderr || containers.stdout).trim();
  const volumeError = (volume.stderr || volume.stdout).trim();
  const containerErrorLines = containerError.split("\n").filter(Boolean);
  const containersAlreadyAbsent = containerErrorLines.length > 0
    && containerErrorLines.every((line) => /no such container:/i.test(line));
  const volumeAlreadyAbsent = /no such volume|volume .* not found/i.test(volumeError);
  const failures = [];
  if (containers.status !== 0 && !containersAlreadyAbsent) failures.push(`container cleanup failed: ${containerError}`);
  if (volume.status !== 0 && !volumeAlreadyAbsent) failures.push(`volume cleanup failed: ${volumeError}`);
  if (failures.length) fail(failures.join("; "));
}

function curl(options, args, operation) {
  return requireSuccess(execute(required(options, "curl"), args), operation);
}

function captureHttp(options, url) {
  const captureRoot = mkdtempSync(path.join(os.tmpdir(), "sag-fnos-http-"));
  const bodyPath = path.join(captureRoot, "body");
  const headersPath = path.join(captureRoot, "headers");
  try {
    const result = execute(required(options, "curl"), [
      "--silent", "--show-error", "--max-time", "5",
      "--output", bodyPath,
      "--dump-header", headersPath,
      "--write-out", "%{http_code}",
      url,
    ]);
    const readCapture = (file) => {
      try {
        return readFileSync(file, "utf8");
      } catch (error) {
        if (error.code === "ENOENT") return "";
        throw error;
      }
    };
    return {
      curlStatus: result.status,
      curlError: result.stderr.trim(),
      status: result.stdout.trim(),
      headers: readCapture(headersPath),
      body: readCapture(bodyPath),
    };
  } finally {
    rmSync(captureRoot, { recursive: true, force: true });
  }
}

function headerValues(headers, name) {
  const prefix = `${name.toLowerCase()}:`;
  return headers
    .split(/\r?\n/)
    .filter((line) => line.toLowerCase().startsWith(prefix))
    .map((line) => line.slice(line.indexOf(":") + 1).trim());
}

async function requireApiReady(options, attempts = 30) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = captureHttp(options, "http://127.0.0.1:18001/api/v1/system/ready");
    if (response.curlStatus !== 0 || /^5\d\d$/.test(response.status)) {
      if (attempt < attempts) {
        await delay(2_000);
        continue;
      }
      fail(`API readiness request failed after ${attempts} attempts: ${response.curlError || response.status}`);
    }
    if (response.status !== "200") fail(`API readiness must return exact HTTP 200, received ${response.status}`);
    let payload;
    try {
      payload = JSON.parse(response.body);
    } catch (error) {
      fail(`API readiness must return valid JSON: ${error.message}`);
    }
    if (payload?.status !== "ready") fail("API readiness JSON status must equal ready");
    if (payload.db !== true) fail("API readiness JSON db must equal true");
    return;
  }
}

function requireWebRoot(options) {
  const url = "http://127.0.0.1:13001/";
  const response = captureHttp(options, url);
  if (response.curlStatus !== 0) fail(`Web root request failed: ${response.curlError}`);
  if (!["307", "308"].includes(response.status)) {
    fail(`Web root must return exact HTTP 307 or 308, received ${response.status}`);
  }
  const locations = headerValues(response.headers, "Location");
  if (locations.length !== 1) fail("Web root must return exactly one Location header normalized to /login");
  let location;
  try {
    location = new URL(locations[0], url);
  } catch {
    fail("Web root Location must normalize to /login");
  }
  if (location.origin !== new URL(url).origin || `${location.pathname}${location.search}${location.hash}` !== "/login") {
    fail(`Web root Location must normalize to /login, received ${locations[0]}`);
  }
}

function requireWebLogin(options) {
  const response = captureHttp(options, "http://127.0.0.1:13001/login");
  if (response.curlStatus !== 0) fail(`Web login request failed: ${response.curlError}`);
  if (response.status !== "200") fail(`Web login must return exact HTTP 200, received ${response.status}`);
  const contentTypes = headerValues(response.headers, "Content-Type");
  if (contentTypes.length !== 1 || !/^text\/html(?:;|$)/i.test(contentTypes[0])) {
    fail(`Web login Content-Type must be text/html, received ${contentTypes.join(", ") || "missing"}`);
  }
  const body = response.body.trim();
  if (!/^<!doctype html>/i.test(body) || !body.includes("/_next/static/")) {
    fail("Web login must contain stable Next HTML markers");
  }
}

function loginStatus(options, body) {
  const result = curl(options, [
    "--silent", "--show-error", "--max-time", "10",
    "--output", "/dev/null", "--write-out", "%{http_code}",
    "--header", "Content-Type: application/json",
    "--data", JSON.stringify(body),
    "http://127.0.0.1:18001/api/v1/auth/login",
  ], "API login request");
  return result.stdout.trim();
}

async function smoke(options) {
  const apiImage = required(options, "api_image");
  const webImage = required(options, "web_image");
  if (!apiReference.test(apiImage)) fail("--api-image must be the reviewed API repository at an exact sha256 digest");
  if (!webReference.test(webImage)) fail("--web-image must be the reviewed Web repository at an exact sha256 digest");
  const resource = names(options);
  const sessionSecret = randomBytes(32).toString("hex");
  const bootstrapToken = randomBytes(32).toString("hex");
  const password = `FnOS-smoke-${randomBytes(18).toString("base64url")}`;
  try {
    docker(options, ["pull", "--platform", "linux/amd64", apiImage], "exact API digest pull");
    docker(options, ["pull", "--platform", "linux/amd64", webImage], "exact Web digest pull");
    docker(options, ["volume", "create", resource.data], "ephemeral API data volume creation");
    docker(options, [
      "run", "--platform", "linux/amd64", "--detach", "--name", resource.api,
      "--publish", "127.0.0.1:18001:8000",
      "--mount", `type=volume,source=${resource.data},target=/data`,
      "--env", "SAG_ENVIRONMENT=prod",
      "--env", "SAG_DEBUG=false",
      "--env", `SAG_SECRET_KEY=${sessionSecret}`,
      "--env", "SAG_AUTH_MODE=password",
      "--env", `SAG_AUTH_BOOTSTRAP_TOKEN=${bootstrapToken}`,
      "--env", "SAG_DATABASE_URL=sqlite+aiosqlite:////data/sag.db",
      "--env", "SAG_DATA_DIR=/data/engine",
      "--env", "SAG_UPLOAD_DIR=/data/uploads",
      apiImage,
    ], "exact API digest start");
    docker(options, [
      "run", "--platform", "linux/amd64", "--detach", "--name", resource.web,
      "--publish", "127.0.0.1:13001:3000",
      webImage,
    ], "exact Web digest start");
    await requireApiReady(options);
    if (loginStatus(options, { name: "Digest Smoke Owner" }) !== "401") fail("name-only login must return 401 in password mode");
    if (loginStatus(options, { name: "Digest Smoke Owner", password, bootstrap_token: bootstrapToken }) !== "200") {
      fail("bootstrap initialization login must return 200");
    }
    if (loginStatus(options, { name: "Digest Smoke Owner", password }) !== "200") fail("daily password login must return 200");
    requireWebRoot(options);
    requireWebLogin(options);
  } finally {
    cleanup(options);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === "cleanup") {
    cleanup(options);
    return;
  }
  if (options.command === "smoke") {
    required(options, "curl");
    await smoke(options);
    return;
  }
  fail(`unknown command: ${options.command}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
