#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const sourcePackage = path.join(repoRoot, "packages/fnos/sag");
const validator = path.join(repoRoot, "scripts/validate-fnos-release.mjs");
const digestReference = /^[a-z0-9.-]+(?:\/[a-z0-9._-]+)+@sha256:[a-f0-9]{64}$/;
const releaseRepositories = {
  api: "ghcr.io/luoshuai990529/sag-api@",
  web: "ghcr.io/luoshuai990529/sag-web@",
  nginx: "docker.io/library/nginx@",
};
const structuralRepositories = {
  api: "test.invalid/sag-api@",
  web: "test.invalid/sag-web@",
  nginx: "test.invalid/nginx@",
};
const tokens = {
  api: "__SAG_API_IMAGE__",
  web: "__SAG_WEB_IMAGE__",
  nginx: "__SAG_NGINX_IMAGE__",
};

function fail(message) {
  console.error(`fnos-package: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const result = { structuralTest: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--structural-test") {
      result.structuralTest = true;
      continue;
    }
    const names = {
      "--api-image": "api",
      "--web-image": "web",
      "--nginx-image": "nginx",
      "--output": "output",
    };
    const name = names[argument];
    if (!name) fail(`unknown argument: ${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail(`${argument} is required`);
    result[name] = value;
    index += 1;
  }
  return result;
}

function validateInputs(options) {
  for (const name of ["api", "web", "nginx"]) {
    const value = options[name];
    if (!value) fail(`--${name}-image is required`);
    if (!digestReference.test(value)) fail(`--${name}-image must be a lowercase immutable sha256 digest reference`);
    const repositories = options.structuralTest ? structuralRepositories : releaseRepositories;
    if (!value.startsWith(repositories[name])) {
      const kind = options.structuralTest ? "test-only fixture" : "approved release repositories";
      fail(`--${name}-image must use the ${kind}`);
    }
  }
  if (!options.output) fail("--output is required");
  if (options.structuralTest) {
    const output = path.resolve(options.output);
    const temp = path.resolve(os.tmpdir());
    if (output !== temp && !output.startsWith(`${temp}${path.sep}`)) {
      fail("--structural-test output must stay in the operating-system temporary directory");
    }
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.error) fail(`could not run ${command}: ${result.error.message}`);
  if (result.status !== 0) {
    fail(`${command} failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return result;
}

async function packageVersion() {
  const manifest = await readFile(path.join(sourcePackage, "manifest"), "utf8");
  const match = /^version\s*=\s*(\S+)\s*$/m.exec(manifest);
  if (!match) fail("package manifest must define a version");
  return match[1];
}

function imageDigest(reference) {
  return reference.slice(reference.lastIndexOf("@") + 1);
}

function inspectRawImage(name, reference) {
  const result = run("docker", ["buildx", "imagetools", "inspect", "--raw", reference]);
  let image;
  try {
    image = JSON.parse(result.stdout);
  } catch (error) {
    fail(`${name} image inspection did not return JSON: ${error.message}`);
  }
  const indexMediaTypes = new Set([
    "application/vnd.oci.image.index.v1+json",
    "application/vnd.docker.distribution.manifest.list.v2+json",
  ]);
  if (!indexMediaTypes.has(image.mediaType) || !Array.isArray(image.manifests)) {
    fail(`${name} image must resolve to a multi-platform image index`);
  }
  return image;
}

function requirePlatforms(name, image, requiredPlatforms) {
  const platforms = new Set(image.manifests.map(({ platform }) => (
    platform && typeof platform.os === "string" && typeof platform.architecture === "string"
      ? `${platform.os}/${platform.architecture}`
      : ""
  )));
  for (const platform of requiredPlatforms) {
    if (!platforms.has(platform)) fail(`${name} image index is missing ${platform}`);
  }
}

function candidateTagDigest(name, reference, version) {
  const repository = reference.slice(0, reference.lastIndexOf("@"));
  const result = run("docker", [
    "buildx", "imagetools", "inspect", "--format", "{{.Manifest.Digest}}", `${repository}:${version}`,
  ]);
  return result.stdout.trim();
}

async function verifyPublishedImages(options) {
  if (options.structuralTest) return;
  const version = await packageVersion();
  for (const name of ["api", "web", "nginx"]) {
    const image = inspectRawImage(name, options[name]);
    requirePlatforms(name, image, name === "nginx" ? ["linux/amd64"] : ["linux/amd64", "linux/arm64"]);
    if (name === "api" || name === "web") {
      const expectedDigest = imageDigest(options[name]);
      const boundDigest = candidateTagDigest(name, options[name], version);
      if (boundDigest !== expectedDigest) {
        fail(`${name} candidate tag ${version} does not resolve to the supplied digest`);
      }
    }
  }
}

async function renderPackage(renderRoot, options) {
  await cp(sourcePackage, renderRoot, { recursive: true, force: false, errorOnExist: true });
  const composePath = path.join(renderRoot, "app/docker/docker-compose.yaml");
  let compose = await readFile(composePath, "utf8");
  for (const name of ["api", "web", "nginx"]) {
    const occurrences = compose.split(tokens[name]).length - 1;
    if (occurrences !== 1) fail(`package template must contain exactly one ${tokens[name]} token`);
    compose = compose.replace(tokens[name], options[name]);
  }
  if (/__SAG_[A-Z_]+__/.test(compose)) fail("rendered package still contains image placeholders");
  await writeFile(composePath, compose);
  return composePath;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  validateInputs(options);
  await verifyPublishedImages(options);

  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "sag-fnos-render-"));
  const renderedPackage = path.join(temporaryRoot, "sag");
  try {
    const composePath = await renderPackage(renderedPackage, options);
    run(process.execPath, [validator, composePath], { cwd: repoRoot });
    run("fnpack", ["build"], { cwd: renderedPackage });

    const builtPackage = path.join(renderedPackage, "sag.fpk");
    const output = path.resolve(options.output);
    await mkdir(path.dirname(output), { recursive: true });
    await cp(builtPackage, output, { force: true });
    const label = options.structuralTest ? "structural test package built" : "release package built";
    console.log(`${label}: ${output}`);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

await main();
