import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const workflowPath = path.join(repoRoot, ".github/workflows/fnos-image-release.yml");

function job(workflow, name) {
  const match = new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z][a-z-]+:|(?![\\s\\S]))`, "m").exec(workflow);
  assert.ok(match, `missing ${name} job`);
  return match[1];
}

test("fnOS release workflow pins actions and scopes package permissions", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const externalActions = workflow.match(/^\s*-?\s*uses: (?!\.\/)(.+)$/gm) ?? [];

  assert.ok(externalActions.length > 0);
  for (const action of externalActions) assert.match(action, /@[a-f0-9]{40}\s+# v/);
  assert.match(workflow, /^permissions:\n  contents: read$/m);
  assert.doesNotMatch(workflow, /^permissions:\n(?:.*\n)*?  packages:/m);
  assert.doesNotMatch(job(workflow, "candidate"), /packages:/);
  assert.doesNotMatch(job(workflow, "quality"), /packages: write/);
  assert.doesNotMatch(job(workflow, "local-amd64-smoke"), /packages: write/);
  assert.match(job(workflow, "inspect-staging"), /permissions:\n      contents: read\n      packages: read/);
  for (const name of ["staging", "promote"]) {
    assert.match(job(workflow, name), /permissions:\n      contents: read\n      packages: write/);
  }
});

test("fnOS release workflow invokes the executable digest handoff and promotion state machine", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const inspect = job(workflow, "inspect-staging");
  const promote = job(workflow, "promote");

  assert.match(inspect, /outputs:\n      api_digest: \$\{\{ steps\.digests\.outputs\.api_digest \}\}/);
  assert.match(inspect, /web_digest: \$\{\{ steps\.digests\.outputs\.web_digest \}\}/);
  assert.match(inspect, /id: digests/);
  assert.match(inspect, /fnos-release-registry\.mjs verify-staging/);
  assert.match(inspect, /fnos-release-registry\.mjs write-handoff/);
  assert.match(inspect, /--github-output "\$GITHUB_OUTPUT" --artifact verified-digests\.json/);
  assert.match(inspect, /actions\/upload-artifact@[a-f0-9]{40}\s+# v/);
  assert.match(promote, /API_DIGEST: \$\{\{ needs\.inspect-staging\.outputs\.api_digest \}\}/);
  assert.match(promote, /WEB_DIGEST: \$\{\{ needs\.inspect-staging\.outputs\.web_digest \}\}/);
  assert.doesNotMatch(promote, /\$STAGING_TAG/);
  assert.match(promote, /fnos-release-registry\.mjs promote/);
  assert.doesNotMatch(promote, /reconcile_tag\(\)|inspect_final_tag\(\)/);
  assert.match(workflow, /concurrency:\n  group: fnos-candidate-/);
});
