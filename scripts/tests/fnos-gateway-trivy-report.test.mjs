import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const canonicalizer = path.join(repoRoot, "scripts/canonicalize-fnos-trivy-report.mjs");

async function fixture(t, report) {
  const root = await mkdtemp(path.join(os.tmpdir(), "sag-trivy-canonical-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const input = path.join(root, "raw.json");
  const output = path.join(root, "canonical.json");
  await writeFile(input, JSON.stringify(report));
  return { input, output };
}

function run(input, output, scannerExitCode) {
  return spawnSync(process.execPath, [
    canonicalizer,
    "--input", input,
    "--output", output,
    "--scanner-exit-code", String(scannerExitCode),
  ], { cwd: repoRoot, encoding: "utf8" });
}

test("canonicalizes Trivy's documented zero-finding omission to an explicit null only after exit zero", async (t) => {
  const { input, output } = await fixture(t, {
    Results: [{
      Target: "nginx (alpine 3.24.1)",
      Class: "os-pkgs",
      Type: "alpine",
      Packages: [{ ID: "nginx", Name: "nginx", Version: "1.30.4-r1" }],
    }],
  });
  const result = run(input, output, 0);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const canonical = JSON.parse(await readFile(output, "utf8"));
  assert.equal(Object.hasOwn(canonical.Results[0], "Vulnerabilities"), true);
  assert.equal(canonical.Results[0].Vulnerabilities, null);
});

test("refuses to infer zero findings from a missing property after nonzero scanner exit", async (t) => {
  const { input, output } = await fixture(t, {
    Results: [{
      Target: "nginx",
      Class: "os-pkgs",
      Type: "alpine",
      Packages: [{ ID: "nginx" }],
    }],
  });
  const result = run(input, output, 2);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cannot infer zero findings/i);
  await assert.rejects(access(output));
});

test("preserves an explicit Trivy vulnerability array without changing findings", async (t) => {
  const vulnerability = {
    VulnerabilityID: "CVE-TEST-1",
    Severity: "HIGH",
    FixedVersion: "1.2.3-r1",
  };
  const { input, output } = await fixture(t, {
    Results: [{
      Target: "nginx",
      Class: "os-pkgs",
      Type: "alpine",
      Vulnerabilities: [vulnerability],
    }],
  });
  const result = run(input, output, 1);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const canonical = JSON.parse(await readFile(output, "utf8"));
  assert.deepEqual(canonical.Results[0].Vulnerabilities, [vulnerability]);
});
