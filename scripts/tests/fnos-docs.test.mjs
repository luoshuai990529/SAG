import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const docsRoot = path.join(repoRoot, "docs/fnos");

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
