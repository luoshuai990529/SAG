import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const summarizer = path.join(repoRoot, "scripts/summarize-fnos-gateway-scan.mjs");
const reference = "docker.io/library/nginx:1.30.4-alpine@sha256:97d490c12ba55b4946b01546d1c3ed324e8d41ab1c9fcb2a616aa470620e5b46";

async function fixture(t, vulnerabilities = []) {
  const root = await mkdtemp(path.join(os.tmpdir(), "sag-gateway-scan-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const report = path.join(root, "report.json");
  const output = path.join(root, "summary.json");
  await writeFile(report, JSON.stringify({
    SchemaVersion: 2,
    CreatedAt: "2026-07-29T16:33:41.448549+08:00",
    ArtifactName: reference,
    ArtifactType: "container_image",
    Metadata: {
      OS: { Family: "alpine", Name: "3.24.1" },
      ImageID: `sha256:${"6".repeat(64)}`,
      RepoDigests: ["nginx@sha256:97d490c12ba55b4946b01546d1c3ed324e8d41ab1c9fcb2a616aa470620e5b46"],
    },
    Results: [{ Target: "nginx", Vulnerabilities: vulnerabilities }],
  }));
  return { report, output };
}

function summarize(report, output) {
  return spawnSync(process.execPath, [
    summarizer,
    "--report", report,
    "--output", output,
    "--scanner-version", "0.70.0",
  ], { cwd: repoRoot, encoding: "utf8" });
}

test("stores compact evidence for a passed exact-digest gateway scan", async (t) => {
  const { report, output } = await fixture(t);
  const result = summarize(report, output);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

  const evidence = JSON.parse(await readFile(output, "utf8"));
  assert.equal(evidence.image.reference, reference);
  assert.equal(evidence.scan.result, "passed");
  assert.equal(evidence.scan.fixableHighCriticalFindings, 0);
  assert.equal(evidence.scan.scanner, "aquasecurity/trivy");
  assert.equal(evidence.scan.scannerVersion, "0.70.0");
  assert.equal(evidence.scan.platform, "linux/amd64");
  assert.match(evidence.scan.sourceReportSha256, /^[a-f0-9]{64}$/);
  assert.equal(Object.hasOwn(evidence, "Results"), false);
});

test("refuses to summarize a report containing a vulnerability finding", async (t) => {
  const { report, output } = await fixture(t, [{
    VulnerabilityID: "CVE-TEST-1",
    Severity: "HIGH",
    FixedVersion: "1.2.3-r1",
  }]);
  const result = summarize(report, output);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /contains 1 finding/i);
  const evidence = JSON.parse(await readFile(output, "utf8"));
  assert.equal(evidence.scan.result, "failed");
  assert.equal(evidence.scan.fixableHighCriticalFindings, 1);
});
