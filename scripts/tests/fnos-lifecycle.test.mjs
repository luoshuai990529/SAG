import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, truncate, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const commandRoot = path.join(repoRoot, "packages/fnos/sag/cmd");
const helperScript = path.join(repoRoot, "packages/fnos/sag/app/docker/lifecycle.py");

async function writeCommand(binDir, name, body) {
  const command = path.join(binDir, name);
  await writeFile(command, `#!/bin/bash\nset -eu\n${body}\n`);
  await chmod(command, 0o755);
}

async function lifecycleFixture(t, overrides = {}) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "sag-fnos-lifecycle-")));
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
if [ "\${1:-}" = compose ] && [ "\${4:-}" = stop ]; then
  exit "\${FAKE_DOCKER_STOP_EXIT:-0}"
fi
if [ "\${1:-}" = compose ] && [ "\${4:-}" = ps ]; then
  printf '%s\\n' "\${FAKE_COMPOSE_RUNNING_IDS-container-id}"
  exit "\${FAKE_DOCKER_PS_EXIT:-0}"
fi
case "$*" in
  *SAG_LIFECYCLE_ACTION=size*)
    printf '%s\\n' "\${FAKE_DATA_KIB_OUTPUT-100}"
    exit "\${FAKE_DATA_KIB_EXIT:-0}"
    ;;
  *SAG_LIFECYCLE_ACTION=backup*)
    [ "\${FAKE_HELPER_BACKUP_EXIT:-0}" -eq 0 ] || exit "$FAKE_HELPER_BACKUP_EXIT"
    archive_path=''
    for argument in "$@"; do
      case "$argument" in SAG_ARCHIVE_TEMP=*) archive_path="\${argument#SAG_ARCHIVE_TEMP=}" ;; esac
    done
    [ -n "$archive_path" ] || exit 2
    : > "$FAKE_BACKUP_DIR/\${archive_path##*/}"
    /bin/chmod "\${FAKE_ARCHIVE_MODE:-600}" "$FAKE_BACKUP_DIR/\${archive_path##*/}"
    exit 0
    ;;
  *SAG_LIFECYCLE_ACTION=delete*)
    [ "\${FAKE_HELPER_DELETE_EXIT:-0}" -eq 0 ] || exit "$FAKE_HELPER_DELETE_EXIT"
    if [ -d "$FAKE_DATA_DIR" ]; then
      /bin/chmod -R 700 "$FAKE_DATA_DIR"
      /usr/bin/find "$FAKE_DATA_DIR" -mindepth 1 -exec /bin/rm -rf {} +
    fi
    exit 0
    ;;
esac
exit "\${FAKE_DOCKER_EXIT:-0}"
  `);
  await writeCommand(binDir, "curl", `
printf 'curl %s\\n' "$*" >> "$FAKE_COMMAND_LOG"
exit "\${FAKE_CURL_EXIT:-0}"
  `);
  await writeCommand(binDir, "du", `
printf 'du %s\\n' "$*" >> "$FAKE_COMMAND_LOG"
printf '%s\\t%s\\n' "\${FAKE_DU_KIB:-100}" "\${2:-}"
exit "\${FAKE_DU_EXIT:-0}"
  `);
  await writeCommand(binDir, "df", `
printf 'df %s\\n' "$*" >> "$FAKE_COMMAND_LOG"
printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\\n'
if [ "\${FAKE_DF_EMPTY_ROW:-0}" -ne 1 ]; then
  printf 'fake 100000 1 %s 1%% /fake\\n' "\${FAKE_DF_AVAILABLE_KIB:-10000}"
fi
exit "\${FAKE_DF_EXIT:-0}"
  `);
  await writeCommand(binDir, "chmod", `
case "$*" in
  *sag.env.tmp.*) if [ "\${FAKE_CHMOD_EXIT:-0}" -ne 0 ]; then exit "$FAKE_CHMOD_EXIT"; fi ;;
esac
exec /bin/chmod "$@"
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
      FAKE_BACKUP_DIR: path.join(pkgVar, "backup"),
      FAKE_DATA_DIR: path.join(pkgVar, "data"),
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

test("container lifecycle helper archives the full tree privately and deletes nested contents", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sag-fnos-helper-"));
  const data = path.join(root, "data");
  const backup = path.join(root, "backup");
  await mkdir(path.join(data, "nested"), { recursive: true });
  await mkdir(backup, { recursive: true });
  await writeFile(path.join(data, "sag.db"), "database");
  await writeFile(path.join(data, "nested/source.pdf"), "document");
  await writeFile(path.join(data, ".state"), "hidden");
  const sparseFile = path.join(data, "sparse.bin");
  await writeFile(sparseFile, "");
  await truncate(sparseFile, 4 * 1024 * 1024);
  t.after(async () => rm(root, { recursive: true, force: true }));

  const helperEnv = {
    ...process.env,
    SAG_DATA_ROOT: data,
    SAG_BACKUP_ROOT: backup,
  };
  const size = spawnSync("python3", [helperScript], {
    encoding: "utf8",
    env: { ...helperEnv, SAG_LIFECYCLE_ACTION: "size" },
  });
  assert.equal(size.status, 0, size.stderr);
  assert.ok(Number.parseInt(size.stdout, 10) >= 4096, size.stdout);

  const archiveName = "full-data.tar.gz.tmp";
  const archived = spawnSync("python3", [helperScript], {
    encoding: "utf8",
    env: {
      ...helperEnv,
      SAG_LIFECYCLE_ACTION: "backup",
      SAG_ARCHIVE_TEMP: `/backup/${archiveName}`,
    },
  });
  assert.equal(archived.status, 0, archived.stderr);
  const archive = path.join(backup, archiveName);
  assert.equal((await stat(archive)).mode & 0o777, 0o600);
  const listing = spawnSync("tar", ["-tzf", archive], { encoding: "utf8" });
  assert.equal(listing.status, 0, listing.stderr);
  assert.match(listing.stdout, /^data\/$/m);
  assert.match(listing.stdout, /^data\/sag\.db$/m);
  assert.match(listing.stdout, /^data\/nested\/source\.pdf$/m);
  assert.match(listing.stdout, /^data\/\.state$/m);

  const deleted = spawnSync("python3", [helperScript], {
    encoding: "utf8",
    env: { ...helperEnv, SAG_LIFECYCLE_ACTION: "delete" },
  });
  assert.equal(deleted.status, 0, deleted.stderr);
  assert.deepEqual(await readdir(data), []);
});

test("container lifecycle helper rejects traversal and exclusive-create collisions", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sag-fnos-helper-guard-"));
  const data = path.join(root, "data");
  const backup = path.join(root, "backup");
  await mkdir(data, { recursive: true });
  await mkdir(backup, { recursive: true });
  await writeFile(path.join(data, "value"), "data");
  t.after(async () => rm(root, { recursive: true, force: true }));
  const baseEnv = { ...process.env, SAG_DATA_ROOT: data, SAG_BACKUP_ROOT: backup, SAG_LIFECYCLE_ACTION: "backup" };

  const traversal = spawnSync("python3", [helperScript], {
    encoding: "utf8",
    env: { ...baseEnv, SAG_ARCHIVE_TEMP: "/backup/../escape.tar.gz.tmp" },
  });
  assert.notEqual(traversal.status, 0);
  await assert.rejects(stat(path.join(root, "escape.tar.gz.tmp")), { code: "ENOENT" });

  const collision = path.join(backup, "collision.tar.gz.tmp");
  await writeFile(collision, "preserve-existing");
  const collided = spawnSync("python3", [helperScript], {
    encoding: "utf8",
    env: { ...baseEnv, SAG_ARCHIVE_TEMP: "/backup/collision.tar.gz.tmp" },
  });
  assert.notEqual(collided.status, 0);
  assert.equal(await readFile(collision, "utf8"), "preserve-existing");
});

test("container lifecycle helper cleans partial archives and preserves symlink semantics", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sag-fnos-helper-links-"));
  const data = path.join(root, "data");
  const backup = path.join(root, "backup");
  const external = path.join(root, "external");
  await mkdir(data, { recursive: true });
  await mkdir(backup, { recursive: true });
  await mkdir(external, { recursive: true });
  await writeFile(path.join(external, "outside.txt"), "outside");
  await symlink(external, path.join(data, "external-link"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const baseEnv = { ...process.env, SAG_DATA_ROOT: data, SAG_BACKUP_ROOT: backup };

  const linkedArchive = "links.tar.gz.tmp";
  const archived = spawnSync("python3", [helperScript], {
    encoding: "utf8",
    env: { ...baseEnv, SAG_LIFECYCLE_ACTION: "backup", SAG_ARCHIVE_TEMP: `/backup/${linkedArchive}` },
  });
  assert.equal(archived.status, 0, archived.stderr);
  const linkMetadata = spawnSync("python3", ["-c", "import sys,tarfile; m=tarfile.open(sys.argv[1]).getmember('data/external-link'); print(m.issym(), m.linkname)", path.join(backup, linkedArchive)], { encoding: "utf8" });
  assert.equal(linkMetadata.status, 0, linkMetadata.stderr);
  assert.match(linkMetadata.stdout, /^True /);

  const deleted = spawnSync("python3", [helperScript], {
    encoding: "utf8",
    env: { ...baseEnv, SAG_LIFECYCLE_ACTION: "delete" },
  });
  assert.equal(deleted.status, 0, deleted.stderr);
  assert.equal(await readFile(path.join(external, "outside.txt"), "utf8"), "outside");
  assert.deepEqual(await readdir(data), []);

  const unreadable = path.join(data, "unreadable.bin");
  await writeFile(unreadable, "private");
  await chmod(unreadable, 0o000);
  const partialName = "partial.tar.gz.tmp";
  let failed;
  try {
    failed = spawnSync("python3", [helperScript], {
      encoding: "utf8",
      env: { ...baseEnv, SAG_LIFECYCLE_ACTION: "backup", SAG_ARCHIVE_TEMP: `/backup/${partialName}` },
    });
  } finally {
    await chmod(unreadable, 0o600);
  }
  assert.notEqual(failed.status, 0);
  await assert.rejects(stat(path.join(backup, partialName)), { code: "ENOENT" });
});

for (const source of ["data", "backup"]) {
  test(`upgrade rejects a ${source} mount-source symlink before Docker`, async (t) => {
    const fixture = await lifecycleFixture(t);
    const external = path.join(fixture.root, `external-${source}`);
    await mkdir(external, { recursive: true });
    if (source === "data") {
      await symlink(external, path.join(fixture.pkgVar, "data"));
      await mkdir(path.join(fixture.pkgVar, "backup"), { recursive: true });
    } else {
      await mkdir(path.join(fixture.pkgVar, "data"), { recursive: true });
      await symlink(external, path.join(fixture.pkgVar, "backup"));
    }

    const result = runScript("upgrade_init", fixture.env);

    assert.notEqual(result.status, 0);
    assert.doesNotMatch(await readFile(fixture.commandLog, "utf8"), /^docker /m);
    assert.match(await readFile(fixture.tempLog, "utf8"), /unsafe.*mount source/i);
  });
}

test("explicit uninstall rejects a substituted data symlink before Docker", async (t) => {
  const fixture = await lifecycleFixture(t);
  const external = path.join(fixture.root, "external-delete-target");
  await mkdir(external, { recursive: true });
  await writeFile(path.join(external, "keep.txt"), "keep");
  await symlink(external, path.join(fixture.pkgVar, "data"));

  const result = runScript("uninstall_callback", { ...fixture.env, SAG_DELETE_DATA: "true" });

  assert.notEqual(result.status, 0);
  assert.equal(await readFile(path.join(external, "keep.txt"), "utf8"), "keep");
  assert.doesNotMatch(await readFile(fixture.commandLog, "utf8"), /^docker /m);
  assert.match(await readFile(fixture.tempLog, "utf8"), /unsafe.*mount source/i);
});

test("upgrade rejects a noncanonical package parent before Docker", async (t) => {
  const fixture = await lifecycleFixture(t);
  const actual = path.join(fixture.root, "actual-private-var");
  const alias = path.join(fixture.root, "aliased-private-var");
  await mkdir(path.join(actual, "data"), { recursive: true });
  await mkdir(path.join(actual, "backup"), { recursive: true });
  await symlink(actual, alias);

  const result = runScript("upgrade_init", { ...fixture.env, TRIM_PKGVAR: alias });

  assert.notEqual(result.status, 0);
  assert.doesNotMatch(await readFile(fixture.commandLog, "utf8"), /^docker /m);
  assert.match(await readFile(fixture.tempLog, "utf8"), /unsafe.*package parent/i);
});

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
    assert.equal((await stat(directory)).mode & 0o777, 0o700);
  }
  assert.equal((await stat(fixture.pkgVar)).mode & 0o777, 0o700);

  await chmod(envFile, 0o644);
  const second = runScript("install_callback", fixture.env);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(await readFile(envFile, "utf8"), initial);
  assert.equal((await stat(envFile)).mode & 0o777, 0o600);
});

test("install rejects an existing malformed secret without overwriting it", async (t) => {
  const fixture = await lifecycleFixture(t);
  const envFile = path.join(fixture.pkgEtc, "sag.env");
  await writeFile(envFile, "SAG_SECRET_KEY=weak\n");

  const result = runScript("install_callback", fixture.env);

  assert.notEqual(result.status, 0);
  assert.equal(await readFile(envFile, "utf8"), "SAG_SECRET_KEY=weak\n");
  assert.match(await readFile(fixture.tempLog, "utf8"), /invalid existing secret/i);
});

test("install logs a user-visible error when temporary secret protection fails", async (t) => {
  const fixture = await lifecycleFixture(t, { FAKE_CHMOD_EXIT: "7" });

  const result = runScript("install_callback", fixture.env);

  assert.notEqual(result.status, 0);
  await assert.rejects(stat(path.join(fixture.pkgEtc, "sag.env")), { code: "ENOENT" });
  assert.match(await readFile(fixture.tempLog, "utf8"), /could not protect its temporary secret/i);
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
    FAKE_DATA_KIB_OUTPUT: "4096",
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
  assert.doesNotMatch(commands, /docker compose .* stop/);
  assert.doesNotMatch(commands, /SAG_LIFECYCLE_ACTION=backup/);
  assert.doesNotMatch(commands, /^tar /m);
  assert.match(await readFile(fixture.tempLog, "utf8"), /insufficient free space/i);
});

test("upgrade refuses a missing active data tree without creating it", async (t) => {
  const fixture = await lifecycleFixture(t);

  const result = runScript("upgrade_init", fixture.env);

  assert.notEqual(result.status, 0);
  await assert.rejects(stat(path.join(fixture.pkgVar, "data")), { code: "ENOENT" });
  const commands = await readFile(fixture.commandLog, "utf8");
  assert.doesNotMatch(commands, /^docker /m);
  assert.doesNotMatch(commands, /^tar /m);
  assert.match(await readFile(fixture.tempLog, "utf8"), /active data directory is missing/i);
});

test("upgrade rejects a size helper that prints a plausible value then fails", async (t) => {
  const fixture = await lifecycleFixture(t, { FAKE_DATA_KIB_EXIT: "7" });
  const dataFile = path.join(fixture.pkgVar, "data/keep.txt");
  await mkdir(path.dirname(dataFile), { recursive: true });
  await writeFile(dataFile, "unchanged\n");

  const result = runScript("upgrade_init", fixture.env);

  assert.notEqual(result.status, 0);
  assert.equal(await readFile(dataFile, "utf8"), "unchanged\n");
  const commands = await readFile(fixture.commandLog, "utf8");
  assert.doesNotMatch(commands, /docker compose .* stop/);
  assert.doesNotMatch(commands, /SAG_LIFECYCLE_ACTION=backup/);
  assert.doesNotMatch(commands, /^tar /m);
  assert.match(await readFile(fixture.tempLog, "utf8"), /could not measure the active data tree/i);
});

test("upgrade rejects a df producer that prints a plausible value then fails", async (t) => {
  const fixture = await lifecycleFixture(t, { FAKE_DF_EXIT: "8" });
  const dataFile = path.join(fixture.pkgVar, "data/keep.txt");
  await mkdir(path.dirname(dataFile), { recursive: true });
  await writeFile(dataFile, "unchanged\n");

  const result = runScript("upgrade_init", fixture.env);

  assert.notEqual(result.status, 0);
  assert.equal(await readFile(dataFile, "utf8"), "unchanged\n");
  const commands = await readFile(fixture.commandLog, "utf8");
  assert.doesNotMatch(commands, /docker compose .* stop/);
  assert.doesNotMatch(commands, /SAG_LIFECYCLE_ACTION=backup/);
  assert.doesNotMatch(commands, /^tar /m);
  assert.match(await readFile(fixture.tempLog, "utf8"), /could not measure free backup space/i);
});

for (const [label, value] of [["empty", ""], ["malformed", "12x"]]) {
  test(`upgrade rejects ${label} data size before stopping services`, async (t) => {
    const fixture = await lifecycleFixture(t, { FAKE_DATA_KIB_OUTPUT: value });
    await mkdir(path.join(fixture.pkgVar, "data"), { recursive: true });

    const result = runScript("upgrade_init", fixture.env);

    assert.notEqual(result.status, 0);
    const commands = await readFile(fixture.commandLog, "utf8");
    assert.doesNotMatch(commands, /docker compose .* stop/);
    assert.doesNotMatch(commands, /SAG_LIFECYCLE_ACTION=backup/);
    assert.match(await readFile(fixture.tempLog, "utf8"), /invalid active data size/i);
  });
}

test("upgrade rejects a missing df data row before stopping services", async (t) => {
  const fixture = await lifecycleFixture(t, { FAKE_DF_EMPTY_ROW: "1" });
  await mkdir(path.join(fixture.pkgVar, "data"), { recursive: true });

  const result = runScript("upgrade_init", fixture.env);

  assert.notEqual(result.status, 0);
  const commands = await readFile(fixture.commandLog, "utf8");
  assert.doesNotMatch(commands, /docker compose .* stop/);
  assert.doesNotMatch(commands, /SAG_LIFECYCLE_ACTION=backup/);
  assert.match(await readFile(fixture.tempLog, "utf8"), /invalid available backup space/i);
});

test("upgrade rejects malformed available space before stopping services", async (t) => {
  const fixture = await lifecycleFixture(t, { FAKE_DF_AVAILABLE_KIB: "12x" });
  await mkdir(path.join(fixture.pkgVar, "data"), { recursive: true });

  const result = runScript("upgrade_init", fixture.env);

  assert.notEqual(result.status, 0);
  const commands = await readFile(fixture.commandLog, "utf8");
  assert.doesNotMatch(commands, /docker compose .* stop/);
  assert.doesNotMatch(commands, /SAG_LIFECYCLE_ACTION=backup/);
  assert.match(await readFile(fixture.tempLog, "utf8"), /invalid available backup space/i);
});

test("upgrade delegates root-like private data backup to the pinned lifecycle helper", async (t) => {
  const fixture = await lifecycleFixture(t);
  const lockedDir = path.join(fixture.pkgVar, "data/root-private");
  const lockedFile = path.join(lockedDir, "secret.bin");
  await mkdir(path.join(fixture.pkgVar, "backup"), { recursive: true });
  await mkdir(lockedDir, { recursive: true });
  await writeFile(lockedFile, "private\n");
  await chmod(lockedFile, 0o000);
  await chmod(lockedDir, 0o000);

  let result;
  try {
    result = runScript("upgrade_init", fixture.env);
  } finally {
    await chmod(lockedDir, 0o700).catch(() => {});
    await chmod(lockedFile, 0o600).catch(() => {});
  }

  assert.equal(result.status, 0, result.stderr);
  const commands = await readFile(fixture.commandLog, "utf8");
  assert.match(commands, /SAG_LIFECYCLE_ACTION=backup/);
  assert.doesNotMatch(commands, /^tar /m);
});

test("upgrade cold-backs up the complete data tree with a temp archive and atomic rename", async (t) => {
  const fixture = await lifecycleFixture(t);
  await mkdir(path.join(fixture.pkgVar, "backup"), { recursive: true });
  await mkdir(path.join(fixture.pkgVar, "data/uploads/nested"), { recursive: true });
  await writeFile(path.join(fixture.pkgVar, "data/sag.db"), "database");
  await writeFile(path.join(fixture.pkgVar, "data/uploads/nested/source.pdf"), "document");
  await chmod(path.join(fixture.pkgVar, "data"), 0o755);
  await chmod(path.join(fixture.pkgVar, "backup"), 0o755);

  const result = runScript("upgrade_init", fixture.env);

  assert.equal(result.status, 0, result.stderr);
  const backupFiles = await readdir(path.join(fixture.pkgVar, "backup"));
  assert.equal(backupFiles.length, 1);
  assert.match(backupFiles[0], /^sag-data-.*\.tar\.gz$/);
  assert.doesNotMatch(backupFiles[0], /\.tmp/);
  assert.equal((await stat(path.join(fixture.pkgVar, "data"))).mode & 0o777, 0o700);
  assert.equal((await stat(path.join(fixture.pkgVar, "backup"))).mode & 0o777, 0o700);
  assert.equal((await stat(path.join(fixture.pkgVar, "backup", backupFiles[0]))).mode & 0o777, 0o600);
  const commands = await readFile(fixture.commandLog, "utf8");
  assert.match(commands, /docker compose -f .*docker-compose\.yaml stop/);
  assert.match(commands, /SAG_LIFECYCLE_ACTION=backup/);
  assert.doesNotMatch(commands, /^tar /m);
  assert.doesNotMatch(commands, /docker compose -f .*docker-compose\.yaml start/);
  assert.ok(commands.indexOf(" stop") < commands.indexOf("SAG_LIFECYCLE_ACTION=backup"));
});

test("failed archive creation preserves active data and leaves no partial backup", async (t) => {
  const fixture = await lifecycleFixture(t, { FAKE_HELPER_BACKUP_EXIT: "7" });
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
  assert.match(commands, /SAG_LIFECYCLE_ACTION=backup/);
  assert.doesNotMatch(commands, /^tar /m);
  assert.match(await readFile(fixture.tempLog, "utf8"), /backup archive failed/i);
});

test("backup failure does not restart an application that was already stopped", async (t) => {
  const fixture = await lifecycleFixture(t, {
    FAKE_COMPOSE_RUNNING_IDS: "",
    FAKE_HELPER_BACKUP_EXIT: "7",
  });
  await mkdir(path.join(fixture.pkgVar, "backup"), { recursive: true });
  await mkdir(path.join(fixture.pkgVar, "data"), { recursive: true });

  const result = runScript("upgrade_init", fixture.env);

  assert.notEqual(result.status, 0);
  const commands = await readFile(fixture.commandLog, "utf8");
  assert.match(commands, /docker compose .* ps --status running -q/);
  assert.match(commands, /docker compose .* stop/);
  assert.doesNotMatch(commands, /docker compose .* start/);
});

test("a partially failing Compose stop still triggers best-effort service recovery", async (t) => {
  const fixture = await lifecycleFixture(t, { FAKE_DOCKER_STOP_EXIT: "9" });
  await mkdir(path.join(fixture.pkgVar, "data"), { recursive: true });

  const result = runScript("upgrade_init", fixture.env);

  assert.notEqual(result.status, 0);
  const commands = await readFile(fixture.commandLog, "utf8");
  assert.match(commands, /docker compose .* stop/);
  assert.match(commands, /docker compose .* start/);
  assert.doesNotMatch(commands, /^tar /m);
  assert.match(await readFile(fixture.tempLog, "utf8"), /could not stop services/i);
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
  assert.match(await readFile(fixture.commandLog, "utf8"), /SAG_LIFECYCLE_ACTION=delete/);
});

test("explicit uninstall delegates non-writable nested data deletion to the pinned lifecycle helper", async (t) => {
  const fixture = await lifecycleFixture(t);
  const lockedDir = path.join(fixture.pkgVar, "data/root-private");
  const lockedFile = path.join(lockedDir, "secret.bin");
  await mkdir(lockedDir, { recursive: true });
  await writeFile(lockedFile, "private\n");
  await chmod(lockedFile, 0o000);
  await chmod(lockedDir, 0o000);

  let result;
  try {
    result = runScript("uninstall_callback", { ...fixture.env, SAG_DELETE_DATA: "true" });
  } finally {
    await chmod(lockedDir, 0o700).catch(() => {});
    await chmod(lockedFile, 0o600).catch(() => {});
  }

  assert.equal(result.status, 0, result.stderr);
  await assert.rejects(stat(path.join(fixture.pkgVar, "data")), { code: "ENOENT" });
  assert.match(await readFile(fixture.commandLog, "utf8"), /SAG_LIFECYCLE_ACTION=delete/);
});
