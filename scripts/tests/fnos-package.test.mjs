import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const builder = path.join(repoRoot, "scripts/build-fnos-package.mjs");
const validator = path.join(repoRoot, "scripts/validate-fnos-release.mjs");
const sourcePackage = path.join(repoRoot, "packages/fnos/sag");
const digestA = `sha256:${"a".repeat(64)}`;
const digestB = `sha256:${"b".repeat(64)}`;
const digestC = `sha256:${"c".repeat(64)}`;

async function tempRoot(t, prefix = "sag-fnos-package-test-only-") {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(async () => rm(root, { recursive: true, force: true }));
  return root;
}

function build(args, env = {}) {
  return spawnSync(process.execPath, [builder, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

function structuralArgs(output) {
  return [
    "--structural-test",
    "--api-image", `test.invalid/sag-api@${digestA}`,
    "--web-image", `test.invalid/sag-web@${digestB}`,
    "--nginx-image", `test.invalid/nginx@${digestC}`,
    "--output", output,
  ];
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  return result;
}

test("release build requires all three digest-pinned image references", async (t) => {
  const root = await tempRoot(t);
  const result = build([
    "--api-image", "ghcr.io/luoshuai990529/sag-api:1.4.0-fnos.1",
    "--output", path.join(root, "candidate.fpk"),
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /api-image.*digest|web-image.*required|nginx-image.*required/i);
});

test("test-only fixture references are refused outside structural-test mode", async (t) => {
  const root = await tempRoot(t);
  const result = build(structuralArgs(path.join(root, "candidate.fpk")).slice(1));

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /test-only|approved release repositories/i);
});

test("release build refuses an approved digest when registry inspection fails", async (t) => {
  const root = await tempRoot(t);
  const bin = path.join(root, "bin");
  const docker = path.join(bin, "docker");
  const commandLog = path.join(root, "docker.log");
  const output = path.join(root, "candidate.fpk");
  await mkdir(bin, { recursive: true });
  await writeFile(docker, `#!/bin/bash\nprintf '%s\\n' "$*" >> "$FAKE_DOCKER_LOG"\nexit 9\n`);
  await chmod(docker, 0o755);

  const result = build([
    "--api-image", `ghcr.io/luoshuai990529/sag-api@${digestA}`,
    "--web-image", `ghcr.io/luoshuai990529/sag-web@${digestB}`,
    "--nginx-image", `docker.io/library/nginx@${digestC}`,
    "--output", output,
  ], {
    PATH: `${bin}:${process.env.PATH}`,
    FAKE_DOCKER_LOG: commandLog,
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /docker failed/i);
  assert.match((await readFile(commandLog, "utf8")).trim(), new RegExp(`^buildx imagetools inspect ghcr\\.io/luoshuai990529/sag-api@${digestA}$`));
  await assert.rejects(access(output));
});

test("lifecycle scripts have valid Bash syntax and the official callback shape", () => {
  const scripts = [
    "main",
    "install_init",
    "install_callback",
    "config_init",
    "config_callback",
    "upgrade_init",
    "upgrade_callback",
    "uninstall_init",
    "uninstall_callback",
  ];

  for (const script of scripts) {
    const fullPath = path.join(sourcePackage, "cmd", script);
    const syntax = spawnSync("/bin/bash", ["-n", fullPath], { encoding: "utf8" });
    assert.equal(syntax.status, 0, `${script}: ${syntax.stderr}`);
  }
});

test("structural mode renders and fnpack-builds an official package only in a temp directory", async (t) => {
  const root = await tempRoot(t);
  const output = path.join(root, "sag-structural-test.fpk");
  const result = build(structuralArgs(output));
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /structural test package built/i);
  assert.equal((await stat(output)).isFile(), true);

  const unpacked = path.join(root, "unpacked");
  const app = path.join(root, "app");
  run("mkdir", ["-p", unpacked, app]);
  run("tar", ["-xzf", output, "-C", unpacked]);
  run("tar", ["-xzf", path.join(unpacked, "app.tgz"), "-C", app]);

  const manifest = await readFile(path.join(unpacked, "manifest"), "utf8");
  for (const expected of [
    /appname\s*=\s*sag/m,
    /version\s*=\s*1\.4\.0-fnos\.1/m,
    /platform\s*=\s*x86/m,
    /os_min_version\s*=\s*1\.2\.0302/m,
    /service_port\s*=\s*3080/m,
    /checkport\s*=\s*true/m,
    /ctl_stop\s*=\s*true/m,
  ]) assert.match(manifest, expected);

  const composePath = path.join(app, "docker/docker-compose.yaml");
  const compose = await readFile(composePath, "utf8");
  assert.match(compose, new RegExp(`test\\.invalid/sag-api@${digestA}`));
  assert.match(compose, new RegExp(`test\\.invalid/sag-web@${digestB}`));
  assert.match(compose, new RegExp(`test\\.invalid/nginx@${digestC}`));
  assert.doesNotMatch(compose, /__SAG_(?:API|WEB|NGINX)_IMAGE__/);
  assert.match(compose, /\$\{TRIM_SERVICE_PORT\}:80/);
  assert.match(compose, /\$\{TRIM_PKGETC\}\/sag\.env/);
  assert.match(compose, /\$\{TRIM_PKGVAR\}\/data:\/data/);

  const validation = spawnSync(process.execPath, [validator, composePath], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(validation.status, 0, validation.stderr);

  const resource = JSON.parse(await readFile(path.join(unpacked, "config/resource"), "utf8"));
  assert.deepEqual(resource["docker-project"].projects, [{ name: "sag", path: "docker" }]);
  JSON.parse(await readFile(path.join(unpacked, "config/privilege"), "utf8"));
  JSON.parse(await readFile(path.join(app, "ui/config"), "utf8"));
  const uninstallWizard = JSON.parse(await readFile(path.join(unpacked, "wizard/uninstall_uifile"), "utf8"));
  const choices = uninstallWizard[0].items[0].subitems;
  assert.equal(choices.find(({ key }) => key === "SAG_RETAIN_DATA").defaultValue, true);
  assert.equal(choices.find(({ key }) => key === "SAG_DELETE_DATA").defaultValue, false);

  for (const icon of ["ICON.PNG", "ICON_256.PNG"]) await access(path.join(unpacked, icon));
  await access(path.join(app, "RETAINED_DATA.md"));
  for (const command of await readdir(path.join(unpacked, "cmd"))) {
    assert.notEqual((await stat(path.join(unpacked, "cmd", command))).mode & 0o111, 0, command);
  }
  await assert.rejects(access(path.join(sourcePackage, "sag.fpk")));
});
