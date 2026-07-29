import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const commandRoot = path.join(repoRoot, "packages/fnos/sag/cmd");

async function writeCommand(binDir, name, body) {
  const command = path.join(binDir, name);
  await writeFile(command, `#!/bin/bash\nset -eu\n${body}\n`);
  await chmod(command, 0o755);
}

async function lifecycleFixture(t, overrides = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "sag-fnos-lifecycle-"));
  const binDir = path.join(root, "bin");
  const pkgVar = path.join(root, "var");
  const pkgEtc = path.join(root, "etc");
  const appDest = path.join(root, "app");
  const tempLog = path.join(root, "user-visible.log");
  const commandLog = path.join(root, "commands.log");
  await Promise.all([
    mkdir(binDir, { recursive: true }),
    mkdir(pkgVar, { recursive: true }),
    mkdir(pkgEtc, { recursive: true }),
    mkdir(path.join(appDest, "docker"), { recursive: true }),
  ]);
  await writeFile(path.join(appDest, "docker/docker-compose.yaml"), "services: {}\n");
  await writeFile(commandLog, "");
  await writeFile(tempLog, "");

  await writeCommand(binDir, "docker", `
printf 'docker %s\\n' "$*" >> "$FAKE_COMMAND_LOG"
if [ "\${1:-}" = inspect ]; then
  case "\${3:-}" in
    *State.Status*) printf '%s\\n' "\${FAKE_GATEWAY_STATE:-running}" ;;
    *State.Health.Status*) printf '%s\\n' "\${FAKE_GATEWAY_HEALTH:-healthy}" ;;
    *) exit 2 ;;
  esac
fi
exit "\${FAKE_DOCKER_EXIT:-0}"
  `);
  await writeCommand(binDir, "curl", `
printf 'curl %s\\n' "$*" >> "$FAKE_COMMAND_LOG"
exit "\${FAKE_CURL_EXIT:-0}"
  `);
  await writeCommand(binDir, "du", `
printf 'du %s\\n' "$*" >> "$FAKE_COMMAND_LOG"
printf '%s\\t%s\\n' "\${FAKE_DU_KIB:-100}" "\${2:-}"
  `);
  await writeCommand(binDir, "df", `
printf 'df %s\\n' "$*" >> "$FAKE_COMMAND_LOG"
printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\\n'
printf 'fake 100000 1 %s 1%% /fake\\n' "\${FAKE_DF_AVAILABLE_KIB:-10000}"
  `);
  await writeCommand(binDir, "tar", `
printf 'tar %s\\n' "$*" >> "$FAKE_COMMAND_LOG"
[ "\${FAKE_TAR_EXIT:-0}" -eq 0 ] || exit "$FAKE_TAR_EXIT"
archive=''
while [ "$#" -gt 0 ]; do
  if [ "$1" = -czf ]; then archive="$2"; shift 2; continue; fi
  shift
done
[ -n "$archive" ] || exit 2
: > "$archive"
  `);

  t.after(async () => rm(root, { recursive: true, force: true }));
  return {
    root,
    pkgVar,
    pkgEtc,
    appDest,
    tempLog,
    commandLog,
    env: {
      ...process.env,
      PATH: `${binDir}:/usr/bin:/bin`,
      TRIM_PKGVAR: pkgVar,
      TRIM_PKGETC: pkgEtc,
      TRIM_APPDEST: appDest,
      TRIM_SERVICE_PORT: "3080",
      TRIM_TEMP_LOGFILE: tempLog,
      FAKE_COMMAND_LOG: commandLog,
      ...overrides,
    },
  };
}

function runScript(name, env, args = []) {
  return spawnSync("/bin/bash", [path.join(commandRoot, name), ...args], {
    encoding: "utf8",
    env,
  });
}

test("install creates private directories and an idempotent mode-0600 random secret", async (t) => {
  const fixture = await lifecycleFixture(t);

  const first = runScript("install_callback", fixture.env);
  assert.equal(first.status, 0, first.stderr);
  const envFile = path.join(fixture.pkgEtc, "sag.env");
  const initial = await readFile(envFile, "utf8");
  assert.match(initial, /^SAG_SECRET_KEY=[a-f0-9]{64}\n$/);
  assert.equal((await stat(envFile)).mode & 0o777, 0o600);
  for (const directory of [fixture.pkgEtc, path.join(fixture.pkgVar, "data"), path.join(fixture.pkgVar, "backup")]) {
    assert.equal((await stat(directory)).isDirectory(), true);
  }

  await chmod(envFile, 0o644);
  const second = runScript("install_callback", fixture.env);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(await readFile(envFile, "utf8"), initial);
  assert.equal((await stat(envFile)).mode & 0o777, 0o600);
});

test("status is running only when gateway state and health plus API readiness pass", async (t) => {
  const fixture = await lifecycleFixture(t);
  const healthy = runScript("main", fixture.env, ["status"]);
  assert.equal(healthy.status, 0, healthy.stderr);

  for (const scenario of [
    { env: { FAKE_GATEWAY_STATE: "exited" }, message: /gateway is not running/i },
    { env: { FAKE_GATEWAY_HEALTH: "unhealthy" }, message: /gateway is not healthy/i },
    { env: { FAKE_CURL_EXIT: "22" }, message: /api readiness check failed/i },
  ]) {
    await writeFile(fixture.tempLog, "");
    const result = runScript("main", { ...fixture.env, ...scenario.env }, ["status"]);
    assert.equal(result.status, 3, `${result.stdout}\n${result.stderr}`);
    assert.match(await readFile(fixture.tempLog, "utf8"), scenario.message);
  }
});

test("upgrade refuses insufficient free space before stopping services or touching data", async (t) => {
  const fixture = await lifecycleFixture(t, {
    FAKE_DU_KIB: "4096",
    FAKE_DF_AVAILABLE_KIB: "4096",
  });
  const dataFile = path.join(fixture.pkgVar, "data/keep.txt");
  await mkdir(path.join(fixture.pkgVar, "backup"), { recursive: true });
  await mkdir(path.dirname(dataFile), { recursive: true });
  await writeFile(dataFile, "unchanged\n");

  const result = runScript("upgrade_init", fixture.env);

  assert.notEqual(result.status, 0);
  assert.equal(await readFile(dataFile, "utf8"), "unchanged\n");
  const commands = await readFile(fixture.commandLog, "utf8");
  assert.doesNotMatch(commands, /^docker /m);
  assert.doesNotMatch(commands, /^tar /m);
  assert.match(await readFile(fixture.tempLog, "utf8"), /insufficient free space/i);
});

test("upgrade cold-backs up the complete data tree with a temp archive and atomic rename", async (t) => {
  const fixture = await lifecycleFixture(t);
  await mkdir(path.join(fixture.pkgVar, "backup"), { recursive: true });
  await mkdir(path.join(fixture.pkgVar, "data/uploads/nested"), { recursive: true });
  await writeFile(path.join(fixture.pkgVar, "data/sag.db"), "database");
  await writeFile(path.join(fixture.pkgVar, "data/uploads/nested/source.pdf"), "document");

  const result = runScript("upgrade_init", fixture.env);

  assert.equal(result.status, 0, result.stderr);
  const backupFiles = await readdir(path.join(fixture.pkgVar, "backup"));
  assert.equal(backupFiles.length, 1);
  assert.match(backupFiles[0], /^sag-data-.*\.tar\.gz$/);
  assert.doesNotMatch(backupFiles[0], /\.tmp/);
  const commands = await readFile(fixture.commandLog, "utf8");
  assert.match(commands, /docker compose -f .*docker-compose\.yaml stop/);
  assert.match(commands, /tar -C .*\/var -czf .*\.tmp data/);
  assert.match(commands, /docker compose -f .*docker-compose\.yaml start/);
  assert.ok(commands.indexOf("docker compose") < commands.indexOf("tar "));
});

test("failed archive creation preserves active data and leaves no partial backup", async (t) => {
  const fixture = await lifecycleFixture(t, { FAKE_TAR_EXIT: "7" });
  await mkdir(path.join(fixture.pkgVar, "backup"), { recursive: true });
  const dataFile = path.join(fixture.pkgVar, "data/keep.txt");
  await mkdir(path.dirname(dataFile), { recursive: true });
  await writeFile(dataFile, "unchanged\n");

  const result = runScript("upgrade_init", fixture.env);

  assert.notEqual(result.status, 0);
  assert.equal(await readFile(dataFile, "utf8"), "unchanged\n");
  assert.deepEqual(await readdir(path.join(fixture.pkgVar, "backup")), []);
  const commands = await readFile(fixture.commandLog, "utf8");
  assert.match(commands, /docker compose .* stop/);
  assert.match(commands, /docker compose .* start/);
  assert.match(await readFile(fixture.tempLog, "utf8"), /backup archive failed/i);
});

test("uninstall retains data by default and deletes it only after explicit selection", async (t) => {
  const fixture = await lifecycleFixture(t);
  const dataFile = path.join(fixture.pkgVar, "data/keep.txt");
  await mkdir(path.dirname(dataFile), { recursive: true });
  await writeFile(dataFile, "retain me\n");

  const retained = runScript("uninstall_callback", fixture.env);
  assert.equal(retained.status, 0, retained.stderr);
  assert.equal(await readFile(dataFile, "utf8"), "retain me\n");

  const deleted = runScript("uninstall_callback", { ...fixture.env, SAG_DELETE_DATA: "true" });
  assert.equal(deleted.status, 0, deleted.stderr);
  await assert.rejects(stat(path.join(fixture.pkgVar, "data")), { code: "ENOENT" });
});
