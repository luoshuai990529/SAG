#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";

import { loadGatewayPolicy } from "./fnos-gateway-policy.mjs";

function fail(message) {
  console.error(`fnOS gateway scan: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!value) fail(`${name || "argument"} requires a value`);
    if (name === "--report") options.report = value;
    else if (name === "--output") options.output = value;
    else if (name === "--scanner-version") options.scannerVersion = value;
    else fail(`unknown argument ${name}`);
  }
  for (const name of ["report", "output", "scannerVersion"]) {
    if (!options[name]) fail(`--${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} is required`);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const policy = await loadGatewayPolicy();
  if (options.scannerVersion !== policy.vulnerabilityGate.scannerVersion) {
    fail("scanner version differs from the reviewed policy");
  }

  const raw = await readFile(options.report);
  let report;
  try {
    report = JSON.parse(raw);
  } catch (error) {
    fail(`report is not JSON: ${error.message}`);
  }
  if (report.ArtifactName !== policy.image.reference) fail("report did not scan the exact reviewed image reference");
  if (report.ArtifactType !== "container_image") fail("report artifact is not a container image");
  const vulnerabilities = (report.Results ?? []).flatMap((result) => result.Vulnerabilities ?? []);
  const passed = vulnerabilities.length === 0;

  const summary = {
    schemaVersion: 1,
    image: {
      reference: policy.image.reference,
      indexDigest: policy.image.indexDigest,
      imageId: report.Metadata?.ImageID ?? null,
      os: report.Metadata?.OS ?? null,
    },
    scan: {
      scanner: policy.vulnerabilityGate.scanner,
      scannerVersion: options.scannerVersion,
      platform: policy.vulnerabilityGate.platform,
      severities: policy.vulnerabilityGate.severities,
      ignoreUnfixed: true,
      result: passed ? "passed" : "failed",
      fixableHighCriticalFindings: vulnerabilities.length,
      scannedAt: report.CreatedAt,
      sourceReportSha256: createHash("sha256").update(raw).digest("hex"),
    },
    review: policy.review,
  };
  await writeFile(options.output, `${JSON.stringify(summary, null, 2)}\n`);
  if (!passed) fail(`report contains ${vulnerabilities.length} finding(s)`);
  console.log(`fnOS gateway scan summary written: ${options.output}`);
}

try {
  await main();
} catch (error) {
  fail(error.message);
}
