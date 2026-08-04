import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const workflow = await readFile(
  path.join(repoRoot, ".github", "workflows", "desktop-release.yml"),
  "utf8",
);

test("uses platform-scoped Electron caches without caching build outputs", () => {
  assert.match(workflow, /name: Cache Electron build downloads/);
  assert.match(workflow, /runner\.os.*runner\.arch.*node-22/);
  assert.doesNotMatch(workflow, /apps\/desktop\/node_modules/);
  assert.doesNotMatch(workflow, /apps\/api\/\.venv/);
  assert.doesNotMatch(workflow, /apps\/api\/build\/pyinstaller/);
});

test("allows an explicitly enabled fork E2E without allowing fork publication", () => {
  assert.match(
    workflow,
    /github\.event_name == 'workflow_dispatch'.*vars\.DESKTOP_RELEASE_E2E == 'true'/,
  );
  assert.match(
    workflow,
    /if: github\.repository == 'Zleap-AI\/SAG' && github\.event_name == 'push'/,
  );
});

test("keeps the signed macOS and unsigned Windows release guards", () => {
  assert.match(workflow, /SAG_NOTARIZE: "true"/);
  assert.match(workflow, /codesign --verify --deep --strict --verbose=2/);
  assert.match(workflow, /xcrun stapler validate/);
  assert.match(workflow, /CSC_IDENTITY_AUTO_DISCOVERY: "false"/);
  assert.match(workflow, /Windows installer must remain unsigned for now/);
});
