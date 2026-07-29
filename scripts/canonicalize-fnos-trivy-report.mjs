#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";

function fail(message) {
  throw new Error(`fnOS Trivy report: ${message}`);
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (value === undefined) fail(`${name || "argument"} requires a value`);
    if (name === "--input") options.input = value;
    else if (name === "--output") options.output = value;
    else if (name === "--scanner-exit-code") options.scannerExitCode = Number(value);
    else fail(`unknown argument ${name}`);
  }
  if (!options.input) fail("--input is required");
  if (!options.output) fail("--output is required");
  if (
    !Number.isInteger(options.scannerExitCode)
    || options.scannerExitCode < 0
    || options.scannerExitCode > 255
  ) {
    fail("--scanner-exit-code must be an integer from 0 through 255");
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  let report;
  try {
    report = JSON.parse(await readFile(options.input, "utf8"));
  } catch (error) {
    fail(`input is unavailable or not valid JSON: ${error.message}`);
  }
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    fail("input must be a Trivy report object");
  }
  if (!Array.isArray(report.Results) || report.Results.length === 0) {
    fail("input Results must be a nonempty array");
  }

  for (const [index, result] of report.Results.entries()) {
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      fail(`Results[${index}] must be an object`);
    }
    if (Object.hasOwn(result, "Vulnerabilities")) continue;
    if (options.scannerExitCode !== 0) {
      fail(`cannot infer zero findings for Results[${index}] after nonzero scanner exit`);
    }
    if (
      result.Class !== "os-pkgs"
      || typeof result.Type !== "string"
      || result.Type.length === 0
      || typeof result.Target !== "string"
      || result.Target.length === 0
      || !Array.isArray(result.Packages)
      || result.Packages.length === 0
    ) {
      fail(`cannot infer zero findings for incomplete Results[${index}]`);
    }
    // Trivy 0.70.0 uses json:",omitempty" for a nil vulnerability slice.
    // Exit zero plus a populated OS-package result is the narrow evidence that
    // the omitted field means no matching findings rather than scan failure.
    result.Vulnerabilities = null;
  }

  await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`);
}

try {
  await main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
