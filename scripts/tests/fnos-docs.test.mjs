import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const docsRoot = path.join(repoRoot, "docs/fnos");
const handoffPath = path.join(repoRoot, "docs/SAG-fnOS-Docker应用改造说明-2026-07-30-1048.md");

async function markdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return markdownFiles(entryPath);
    return entry.isFile() && entry.name.endsWith(".md") ? [entryPath] : [];
  }));
  return nested.flat();
}

test("every executable Bash documentation block has valid shell syntax", async () => {
  let blockCount = 0;

  for (const file of await markdownFiles(docsRoot)) {
    const markdown = await readFile(file, "utf8");
    for (const match of markdown.matchAll(/```bash\n([\s\S]*?)```/g)) {
      blockCount += 1;
      const result = spawnSync("/bin/bash", ["-n"], {
        encoding: "utf8",
        input: match[1],
      });
      assert.equal(
        result.status,
        0,
        `${path.relative(repoRoot, file)} Bash block ${blockCount}: ${result.stderr}`,
      );
    }
  }

  assert.ok(blockCount > 0, "expected at least one documented Bash block");
});

test("fnOS operations document the permanent branch and immutable candidate tag handoff", async () => {
  const install = await readFile(path.join(docsRoot, "install-and-network.md"), "utf8");
  const readme = await readFile(path.join(docsRoot, "README.md"), "utf8");
  const acceptance = await readFile(path.join(docsRoot, "acceptance-matrix.md"), "utf8");
  const handoff = await readFile(handoffPath, "utf8");
  const operational = [install, readme, acceptance, handoff].join("\n");

  assert.match(operational, /feat\/fnos-docker-app/);
  assert.match(operational, /fnos-candidate-1\.4\.0-fnos\.1-\$\{revision:0:12\}/);
  assert.match(operational, /关闭 PR #1，不合并/);
  assert.match(operational, /fnos-verified-digests|verified-digests/);
  assert.match(operational, /Package Settings/);
  assert.match(operational, /匿名/);
  assert.doesNotMatch(install, /默认分支 `main` 上手动运行/);
  assert.doesNotMatch(operational, /workflow_dispatch/);
});
