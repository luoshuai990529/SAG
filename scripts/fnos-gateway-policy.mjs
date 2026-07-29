#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
export const gatewayPolicyPath = path.join(repoRoot, "packages/fnos/gateway-policy.json");
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const revisionPattern = /^[a-f0-9]{40}$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const maximumReviewAgeDays = 30;
const indexMediaTypes = new Set([
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
]);

function invariant(condition, message) {
  if (!condition) throw new Error(`fnOS gateway policy: ${message}`);
}

function utcDay(value, label) {
  invariant(typeof value === "string" && datePattern.test(value), `${label} must be an ISO date`);
  const milliseconds = Date.parse(`${value}T00:00:00Z`);
  invariant(Number.isFinite(milliseconds), `${label} must be a valid ISO date`);
  return milliseconds;
}

export function validateGatewayPolicy(policy, now = new Date()) {
  invariant(policy && typeof policy === "object", "policy must be an object");
  invariant(policy.schemaVersion === 1, "schemaVersion must be 1");

  const { image, requiredPlatforms, review, vulnerabilityGate } = policy;
  invariant(image?.repository === "docker.io/library/nginx", "repository must be docker.io/library/nginx");
  invariant(typeof image.tag === "string" && image.tag.length > 0, "tag is required");
  invariant(digestPattern.test(image.indexDigest), "indexDigest must be an exact lowercase sha256 digest");
  const exactReference = `${image.repository}:${image.tag}@${image.indexDigest}`;
  invariant(image.reference === exactReference, "image reference must bind repository, tag, and index digest");

  invariant(Array.isArray(requiredPlatforms) && requiredPlatforms.length >= 2, "requiredPlatforms must include amd64 and arm64");
  const expectedPlatforms = new Set(["linux/amd64", "linux/arm64"]);
  const seenPlatforms = new Set();
  for (const entry of requiredPlatforms) {
    const platform = `${entry?.os}/${entry?.architecture}`;
    invariant(expectedPlatforms.has(platform), `unsupported required platform ${platform}`);
    invariant(!seenPlatforms.has(platform), `duplicate required platform ${platform}`);
    invariant(digestPattern.test(entry.manifestDigest), `${platform} manifestDigest must be an exact lowercase sha256 digest`);
    invariant(revisionPattern.test(entry.upstreamRevision), `${platform} upstreamRevision must be a lowercase full Git revision`);
    seenPlatforms.add(platform);
  }
  for (const platform of expectedPlatforms) {
    invariant(seenPlatforms.has(platform), `requiredPlatforms is missing ${platform}`);
  }

  invariant(review && typeof review === "object", "review metadata is required");
  const reviewed = utcDay(review.reviewedOn, "reviewedOn");
  const expires = utcDay(review.expiresOn, "expiresOn");
  invariant(
    Number.isInteger(review.maximumAgeDays)
      && review.maximumAgeDays > 0
      && review.maximumAgeDays <= maximumReviewAgeDays,
    `maximumAgeDays must be at most ${maximumReviewAgeDays} days`,
  );
  const ageDays = (expires - reviewed) / 86_400_000;
  invariant(ageDays >= 0 && ageDays <= review.maximumAgeDays, "review window exceeds maximumAgeDays");
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  invariant(today >= reviewed, "review date is in the future");
  invariant(today <= expires, `review expired on ${review.expiresOn}`);
  invariant(Array.isArray(review.sources) || review.sources === undefined, "review sources must be an array");

  invariant(vulnerabilityGate?.scanner === "aquasecurity/trivy", "scanner must be aquasecurity/trivy");
  invariant(/^\d+\.\d+\.\d+$/.test(vulnerabilityGate.scannerVersion), "scannerVersion must be explicit");
  invariant(vulnerabilityGate.platform === "linux/amd64", "scan platform must be linux/amd64");
  invariant(
    Array.isArray(vulnerabilityGate.severities)
      && vulnerabilityGate.severities.length === 2
      && vulnerabilityGate.severities.includes("CRITICAL")
      && vulnerabilityGate.severities.includes("HIGH"),
    "scan severities must be exactly CRITICAL and HIGH",
  );
  invariant(vulnerabilityGate.ignoreUnfixed === true, "scan must gate fixable findings with ignoreUnfixed");
  invariant(vulnerabilityGate.exitCodeOnFindings === 1, "scan must exit 1 on findings");
  invariant(vulnerabilityGate.result === "passed", "vulnerability scan result must be passed");
  invariant(vulnerabilityGate.fixableFindings === 0, "vulnerability scan must record zero fixable findings");
  invariant(
    typeof vulnerabilityGate.scannedAt === "string"
      && Number.isFinite(Date.parse(vulnerabilityGate.scannedAt)),
    "scannedAt must be a valid timestamp",
  );
  invariant(
    vulnerabilityGate.scannedAt.slice(0, 10) === review.reviewedOn,
    "scanner evidence and review must be renewed together",
  );
  invariant(
    digestPattern.test(`sha256:${vulnerabilityGate.linuxAmd64ArchiveSha256}`),
    "Linux scanner archive SHA-256 is required",
  );
  invariant(
    digestPattern.test(`sha256:${vulnerabilityGate.macosArm64ArchiveSha256}`),
    "macOS scanner archive SHA-256 is required",
  );
  invariant(digestPattern.test(vulnerabilityGate.imageId), "scanned image ID is required");
  invariant(
    typeof vulnerabilityGate.os?.family === "string"
      && vulnerabilityGate.os.family.length > 0
      && typeof vulnerabilityGate.os?.version === "string"
      && vulnerabilityGate.os.version.length > 0,
    "scanned operating-system evidence is required",
  );
  invariant(
    typeof vulnerabilityGate.sourceReportSha256 === "string"
      && /^[a-f0-9]{64}$/.test(vulnerabilityGate.sourceReportSha256),
    "source report SHA-256 is required",
  );

  return exactReference;
}

export function validateGatewayImageReference(policy, reference) {
  const expected = policy?.image?.reference;
  invariant(reference === expected, `gateway must use the reviewed gateway reference ${expected}`);
  return reference;
}

export function validateGatewayIndex(policy, index) {
  invariant(
    index && indexMediaTypes.has(index.mediaType) && Array.isArray(index.manifests),
    "gateway image must resolve to a multi-platform image index",
  );
  for (const expected of policy.requiredPlatforms) {
    const platformName = `${expected.os}/${expected.architecture}`;
    const matches = index.manifests.filter(({ platform }) => (
      platform?.os === expected.os && platform?.architecture === expected.architecture
    ));
    invariant(matches.length === 1, `${platformName} must occur exactly once in the raw image index`);
    const [actual] = matches;
    invariant(
      actual.digest === expected.manifestDigest,
      `${platformName} manifest digest differs from the reviewed policy`,
    );
    invariant(
      actual.annotations?.["org.opencontainers.image.revision"] === expected.upstreamRevision,
      `${platformName} upstream revision differs from the reviewed policy`,
    );
    invariant(
      actual.annotations?.["org.opencontainers.image.version"] === policy.image.tag,
      `${platformName} image version differs from the reviewed policy`,
    );
  }
}

export async function loadGatewayPolicy(now = new Date()) {
  let policy;
  try {
    policy = JSON.parse(await readFile(gatewayPolicyPath, "utf8"));
  } catch (error) {
    throw new Error(`fnOS gateway policy: could not read ${gatewayPolicyPath}: ${error.message}`);
  }
  validateGatewayPolicy(policy, now);
  return policy;
}

function inspectRaw(reference, docker = "docker") {
  const result = spawnSync(docker, ["buildx", "imagetools", "inspect", "--raw", reference], {
    encoding: "utf8",
  });
  if (result.error) throw new Error(`could not run ${docker}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${docker} failed: ${(result.stderr || result.stdout).trim()}`);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`image inspection did not return JSON: ${error.message}`);
  }
}

async function cli() {
  const [command, ...args] = process.argv.slice(2);
  invariant(command === "verify", "usage: fnos-gateway-policy.mjs verify [--docker <command>]");
  let docker = "docker";
  if (args.length > 0) {
    invariant(args.length === 2 && args[0] === "--docker" && args[1], "only --docker <command> is supported");
    docker = args[1];
  }
  const policy = await loadGatewayPolicy();
  const reference = validateGatewayImageReference(policy, policy.image.reference);
  validateGatewayIndex(policy, inspectRaw(reference, docker));
  console.log(reference);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await cli();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
