#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";

import {
  loadGatewayPolicy,
  parseRfc3339Timestamp,
} from "./fnos-gateway-policy.mjs";

function argumentError(message) {
  console.error(`fnOS gateway scan: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (value === undefined) argumentError(`${name || "argument"} requires a value`);
    if (name === "--report") options.report = value;
    else if (name === "--source-report") options.sourceReport = value;
    else if (name === "--output") options.output = value;
    else if (name === "--scanner-version") options.scannerVersion = value;
    else if (name === "--scanner-exit-code") options.scannerExitCode = Number(value);
    else argumentError(`unknown argument ${name}`);
  }
  for (const name of ["report", "sourceReport", "output", "scannerVersion"]) {
    if (!options[name]) {
      argumentError(`--${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} is required`);
    }
  }
  if (
    !Number.isInteger(options.scannerExitCode)
    || options.scannerExitCode < 0
    || options.scannerExitCode > 255
  ) {
    argumentError("--scanner-exit-code must be an integer from 0 through 255");
  }
  return options;
}

function nonemptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function inspectReport(report, policy, reasons) {
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    reasons.push("report root must be an object");
    return { findings: null, scannedAt: null, imageId: null, os: null };
  }
  if (report.SchemaVersion !== 2) reasons.push("report SchemaVersion must be 2");
  if (report.ArtifactName !== policy.image.reference) {
    reasons.push("report did not scan the exact reviewed image reference");
  }
  if (report.ArtifactType !== "container_image") {
    reasons.push("report artifact type must be container image");
  }

  let scannedAt = null;
  try {
    parseRfc3339Timestamp(report.CreatedAt, { label: "report CreatedAt" });
    scannedAt = report.CreatedAt;
  } catch (error) {
    reasons.push(error.message);
  }

  const imageId = report.Metadata?.ImageID;
  if (typeof imageId !== "string" || !/^sha256:[a-f0-9]{64}$/.test(imageId)) {
    reasons.push("report Metadata.ImageID must be a full lowercase sha256 digest");
  }
  const os = report.Metadata?.OS;
  if (!nonemptyString(os?.Family) || !nonemptyString(os?.Name)) {
    reasons.push("report operating-system Family and Name are required");
  }

  if (!Array.isArray(report.Results) || report.Results.length === 0) {
    reasons.push("report Results must be a nonempty array");
    return {
      findings: null,
      scannedAt,
      imageId: /^sha256:[a-f0-9]{64}$/.test(imageId ?? "") ? imageId : null,
      os: nonemptyString(os?.Family) && nonemptyString(os?.Name) ? os : null,
    };
  }

  let findings = 0;
  for (const [index, result] of report.Results.entries()) {
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      reasons.push(`report Results[${index}] must be an object`);
      continue;
    }
    if (!nonemptyString(result.Target) || !nonemptyString(result.Class) || !nonemptyString(result.Type)) {
      reasons.push(`report Results[${index}] Target, Class, and Type are required`);
    }
    if (!Object.hasOwn(result, "Vulnerabilities")) {
      reasons.push(`report Results[${index}] must explicitly contain a Vulnerabilities property`);
      continue;
    }
    if (result.Vulnerabilities === null) continue;
    if (!Array.isArray(result.Vulnerabilities)) {
      reasons.push(`report Results[${index}].Vulnerabilities must be an array or explicit null`);
      continue;
    }
    findings += result.Vulnerabilities.length;
    for (const [findingIndex, finding] of result.Vulnerabilities.entries()) {
      if (
        !finding
        || typeof finding !== "object"
        || Array.isArray(finding)
        || !nonemptyString(finding.VulnerabilityID)
        || !["HIGH", "CRITICAL"].includes(finding.Severity)
        || !nonemptyString(finding.FixedVersion)
      ) {
        reasons.push(
          `report Results[${index}].Vulnerabilities[${findingIndex}] is not a fixable High/Critical Trivy finding`,
        );
      }
    }
  }
  if (findings > 0) reasons.push(`report contains ${findings} finding(s)`);
  return {
    findings,
    scannedAt,
    imageId: /^sha256:[a-f0-9]{64}$/.test(imageId ?? "") ? imageId : null,
    os: nonemptyString(os?.Family) && nonemptyString(os?.Name) ? os : null,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const reasons = [];
  let policy = null;
  try {
    policy = await loadGatewayPolicy();
  } catch (error) {
    reasons.push(error.message);
  }
  if (policy && options.scannerVersion !== policy.vulnerabilityGate.scannerVersion) {
    reasons.push("scanner version differs from the reviewed policy");
  }
  if (options.scannerExitCode !== 0) {
    reasons.push(`scanner exited with status ${options.scannerExitCode}`);
  }

  let reportBytes = null;
  let report = null;
  try {
    reportBytes = await readFile(options.report);
    try {
      report = JSON.parse(reportBytes);
    } catch (error) {
      reasons.push(`report is not valid JSON: ${error.message}`);
    }
  } catch (error) {
    reasons.push(`report is unavailable: ${error.message}`);
  }

  let sourceReportBytes = null;
  try {
    sourceReportBytes = await readFile(options.sourceReport);
  } catch (error) {
    reasons.push(`source report is unavailable: ${error.message}`);
  }

  const details = report && policy
    ? inspectReport(report, policy, reasons)
    : { findings: null, scannedAt: null, imageId: null, os: null };
  const passed = reasons.length === 0 && options.scannerExitCode === 0 && details.findings === 0;
  const summary = {
    schemaVersion: 1,
    image: {
      reference: policy?.image?.reference ?? null,
      indexDigest: policy?.image?.indexDigest ?? null,
      imageId: details.imageId,
      os: details.os,
    },
    scan: {
      scanner: policy?.vulnerabilityGate?.scanner ?? "aquasecurity/trivy",
      scannerVersion: options.scannerVersion,
      scannerExitCode: options.scannerExitCode,
      platform: policy?.vulnerabilityGate?.platform ?? "linux/amd64",
      severities: policy?.vulnerabilityGate?.severities ?? ["CRITICAL", "HIGH"],
      ignoreUnfixed: policy?.vulnerabilityGate?.ignoreUnfixed ?? true,
      result: passed ? "passed" : "failed",
      failureReasons: passed ? [] : reasons,
      fixableHighCriticalFindings: details.findings,
      scannedAt: details.scannedAt,
      sourceReportSha256: sourceReportBytes
        ? createHash("sha256").update(sourceReportBytes).digest("hex")
        : null,
    },
    review: policy?.review ?? null,
  };
  await writeFile(options.output, `${JSON.stringify(summary, null, 2)}\n`);
  if (!passed) {
    console.error(`fnOS gateway scan: ${reasons.join("; ")}`);
    process.exitCode = 1;
    return;
  }
  console.log(`fnOS gateway scan summary written: ${options.output}`);
}

try {
  await main();
} catch (error) {
  console.error(`fnOS gateway scan: ${error.message}`);
  process.exit(1);
}
