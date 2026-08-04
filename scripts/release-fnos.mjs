#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const versionPattern = /^1\.4\.0-fnos\.\d+$/;

function fail(message) {
  throw new Error(`release-fnos: ${message}`);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (command !== "prepare") fail("only prepare is available in this release foundation step");
  const options = { command };
  for (let index = 0; index < rest.length; index += 2) {
    const name = rest[index];
    const value = rest[index + 1];
    if (!name?.startsWith("--") || !value || value.startsWith("--")) fail(`value required for ${name ?? "argument"}`);
    options[name.slice(2).replaceAll("-", "_")] = value;
  }
  return options;
}

function requireOption(options, name) {
  const value = options[name];
  if (!value) fail(`--${name.replaceAll("_", "-")} is required`);
  return value;
}

function git(...args) {
  const result = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
  if (result.error || result.status !== 0) fail(`git ${args.join(" ")} failed: ${(result.stderr || result.error?.message || result.stdout).trim()}`);
  return result.stdout.trim();
}

function readPackageVersion() {
  const output = git("show", "HEAD:packages/fnos/sag/manifest");
  const match = /^version\s*=\s*(\S+)\s*$/m.exec(output);
  if (!match) fail("packages/fnos/sag/manifest must define version");
  return match[1];
}

async function prepare(options) {
  const version = requireOption(options, "version");
  const channel = requireOption(options, "channel");
  const candidateRunId = requireOption(options, "candidate_run_id");
  const output = path.resolve(requireOption(options, "output"));
  if (!versionPattern.test(version)) fail("--version must match 1.4.0-fnos.<number>");
  if (channel !== "global" && channel !== "cn") fail("--channel must be global or cn");
  if (channel === "cn") fail("cn mirror is not provisioned; no China registry channel is approved yet");
  if (!/^\d+$/.test(candidateRunId)) fail("--candidate-run-id must be numeric");
  if (git("branch", "--show-current") !== "feat/fnos-docker-app") fail("must run from feat/fnos-docker-app");
  if (git("status", "--porcelain", "--untracked-files=no") !== "") fail("tracked worktree changes must be committed before release prepare");
  if (readPackageVersion() !== version) fail("--version must match packages/fnos/sag/manifest");
  if (existsSync(output)) fail("--output must not already exist");
  await mkdir(path.dirname(output), { recursive: true });
  const revision = git("rev-parse", "HEAD");
  const releaseInput = {
    schema_version: 1,
    appname: "sag",
    version,
    channel,
    revision,
    candidate_tag: `fnos-candidate-${version}-${revision.slice(0, 12)}`,
    candidate_workflow: {
      run_id: candidateRunId,
      url: `https://github.com/luoshuai990529/SAG/actions/runs/${candidateRunId}`,
    },
  };
  await writeFile(output, `${JSON.stringify(releaseInput, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`release input written: ${output}\n`);
}

const options = parseArgs(process.argv.slice(2));
prepare(options).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
