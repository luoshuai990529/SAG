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
const digestD = `sha256:${"d".repeat(64)}`;

function imageIndex(platforms) {
  return JSON.stringify({
    schemaVersion: 2,
    mediaType: "application/vnd.oci.image.index.v1+json",
    manifests: platforms.map((platform, index) => ({
      mediaType: "application/vnd.oci.image.manifest.v1+json",
      digest: `sha256:${String.fromCharCode(97 + index).repeat(64)}`,
      size: 123,
      platform,
    })),
  });
}

const amd64 = { os: "linux", architecture: "amd64" };
const arm64 = { os: "linux", architecture: "arm64" };
const validIndex = imageIndex([amd64, arm64]);

async function fakeRegistry(t, {
  apiRaw = validIndex,
  webRaw = validIndex,
  nginxRaw = imageIndex([amd64]),
  apiTagDigest = digestA,
  webTagDigest = digestB,
} = {}) {
  const root = await tempRoot(t, "sag-fnos-registry-test-");
  const bin = path.join(root, "bin");
  const docker = path.join(bin, "docker");
  const fnpack = path.join(bin, "fnpack");
  const compose = JSON.stringify({
    services: {
      api: {
        image: `ghcr.io/luoshuai990529/sag-api@${digestA}`,
        env_file: [{ path: "${TRIM_PKGETC}/sag.env", required: true }],
      },
      web: { image: `ghcr.io/luoshuai990529/sag-web@${digestB}` },
      gateway: { image: `docker.io/library/nginx@${digestC}` },
    },
  });
  await mkdir(bin, { recursive: true });
  await writeFile(docker, `#!/bin/bash
set -eu
if [[ "$1 $2 $3 \${4:-}" == "buildx imagetools inspect --raw" ]]; then
  case "\${5:-}" in
    *sag-api*) printf '%s\\n' "$FAKE_API_RAW" ;;
    *sag-web*) printf '%s\\n' "$FAKE_WEB_RAW" ;;
    *nginx*) printf '%s\\n' "$FAKE_NGINX_RAW" ;;
    *) exit 7 ;;
  esac
elif [[ "$1 $2 $3 \${4:-} \${5:-}" == "buildx imagetools inspect --format {{.Manifest.Digest}}" ]]; then
  case "\${6:-}" in
    *sag-api*) printf '%s\\n' "$FAKE_API_TAG_DIGEST" ;;
    *sag-web*) printf '%s\\n' "$FAKE_WEB_TAG_DIGEST" ;;
    *) exit 8 ;;
  esac
elif [[ "$1 $2" == "compose -f" ]]; then
  printf '%s\\n' "$FAKE_COMPOSE_JSON"
elif [[ "$1 $2 $3" == "buildx imagetools inspect" ]]; then
  exit 0
else
  exit 9
fi
`);
  await writeFile(fnpack, "#!/bin/bash\nset -eu\ntest \"$1\" = build\ntouch sag.fpk\n");
  await chmod(docker, 0o755);
  await chmod(fnpack, 0o755);
  return {
    PATH: `${bin}:${process.env.PATH}`,
    FAKE_API_RAW: apiRaw,
    FAKE_WEB_RAW: webRaw,
    FAKE_NGINX_RAW: nginxRaw,
    FAKE_API_TAG_DIGEST: apiTagDigest,
    FAKE_WEB_TAG_DIGEST: webTagDigest,
    FAKE_COMPOSE_JSON: compose,
  };
}

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
  assert.match((await readFile(commandLog, "utf8")).trim(), new RegExp(`^buildx imagetools inspect --raw ghcr\\.io/luoshuai990529/sag-api@${digestA}$`));
  await assert.rejects(access(output));
});

test("release build rejects an arm64-only API index", async (t) => {
  const root = await tempRoot(t);
  const result = build([
    "--api-image", `ghcr.io/luoshuai990529/sag-api@${digestA}`,
    "--web-image", `ghcr.io/luoshuai990529/sag-web@${digestB}`,
    "--nginx-image", `docker.io/library/nginx@${digestC}`,
    "--output", path.join(root, "candidate.fpk"),
  ], await fakeRegistry(t, { apiRaw: imageIndex([arm64]) }));

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /api.*linux\/amd64/i);
});

test("release build rejects a single-manifest Web image", async (t) => {
  const root = await tempRoot(t);
  const result = build([
    "--api-image", `ghcr.io/luoshuai990529/sag-api@${digestA}`,
    "--web-image", `ghcr.io/luoshuai990529/sag-web@${digestB}`,
    "--nginx-image", `docker.io/library/nginx@${digestC}`,
    "--output", path.join(root, "candidate.fpk"),
  ], await fakeRegistry(t, {
    webRaw: JSON.stringify({ mediaType: "application/vnd.oci.image.manifest.v1+json", config: {} }),
  }));

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /web.*index/i);
});

test("release build rejects an API index missing linux/arm64", async (t) => {
  const root = await tempRoot(t);
  const result = build([
    "--api-image", `ghcr.io/luoshuai990529/sag-api@${digestA}`,
    "--web-image", `ghcr.io/luoshuai990529/sag-web@${digestB}`,
    "--nginx-image", `docker.io/library/nginx@${digestC}`,
    "--output", path.join(root, "candidate.fpk"),
  ], await fakeRegistry(t, { apiRaw: imageIndex([amd64]) }));

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /api.*linux\/arm64/i);
});

test("release build rejects an Nginx index missing linux/amd64", async (t) => {
  const root = await tempRoot(t);
  const result = build([
    "--api-image", `ghcr.io/luoshuai990529/sag-api@${digestA}`,
    "--web-image", `ghcr.io/luoshuai990529/sag-web@${digestB}`,
    "--nginx-image", `docker.io/library/nginx@${digestC}`,
    "--output", path.join(root, "candidate.fpk"),
  ], await fakeRegistry(t, { nginxRaw: imageIndex([arm64]) }));

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /nginx.*linux\/amd64/i);
});

test("release build rejects an API digest not bound to the candidate tag", async (t) => {
  const root = await tempRoot(t);
  const result = build([
    "--api-image", `ghcr.io/luoshuai990529/sag-api@${digestA}`,
    "--web-image", `ghcr.io/luoshuai990529/sag-web@${digestB}`,
    "--nginx-image", `docker.io/library/nginx@${digestC}`,
    "--output", path.join(root, "candidate.fpk"),
  ], await fakeRegistry(t, { apiTagDigest: digestD }));

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /api.*candidate tag.*digest/i);
});

test("release build accepts candidate-bound multi-platform API and Web indexes", async (t) => {
  const root = await tempRoot(t);
  const output = path.join(root, "candidate.fpk");
  const result = build([
    "--api-image", `ghcr.io/luoshuai990529/sag-api@${digestA}`,
    "--web-image", `ghcr.io/luoshuai990529/sag-web@${digestB}`,
    "--nginx-image", `docker.io/library/nginx@${digestC}`,
    "--output", output,
  ], await fakeRegistry(t));

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal((await stat(output)).isFile(), true);
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

test("structural mode renders and fnpack-builds an official package only in a temp directory", {
  skip: process.env.SAG_FNPACK_TESTS !== "1",
}, async (t) => {
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
  assert.match(compose, /lifecycle-size:/);
  assert.match(compose, /profiles:\s*\["lifecycle"\]/);
  assert.match(compose, /network_mode: none/);
  assert.match(compose, /user: "0:0"/);

  const canonical = spawnSync("docker", [
    "compose", "-f", composePath, "config", "--no-interpolate", "--no-path-resolution", "--format", "json",
  ], { cwd: repoRoot, encoding: "utf8" });
  assert.equal(canonical.status, 0, canonical.stderr);
  const helperServices = JSON.parse(canonical.stdout).services;
  const expectedMounts = {
    "lifecycle-size": [["/data", true], ["/opt/sag-lifecycle.py", true]],
    "lifecycle-backup": [["/data", true], ["/backup", false], ["/opt/sag-lifecycle.py", true]],
    "lifecycle-delete": [["/data", false], ["/opt/sag-lifecycle.py", true]],
  };
  for (const [name, mounts] of Object.entries(expectedMounts)) {
    const service = helperServices[name];
    assert.equal(service.image, `test.invalid/sag-api@${digestA}`);
    assert.deepEqual(service.profiles, ["lifecycle"]);
    assert.equal(service.user, "0:0");
    assert.equal(service.network_mode, "none");
    assert.equal(service.read_only, true);
    assert.deepEqual(service.security_opt, ["no-new-privileges:true"]);
    assert.deepEqual(service.cap_drop, ["ALL"]);
    assert.deepEqual(service.cap_add, ["DAC_OVERRIDE"]);
    assert.deepEqual(service.volumes.map(({ target, read_only: readOnly = false }) => [target, readOnly]), mounts);
  }

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
  await access(path.join(app, "docker/lifecycle.py"));
  for (const command of await readdir(path.join(unpacked, "cmd"))) {
    assert.notEqual((await stat(path.join(unpacked, "cmd", command))).mode & 0o111, 0, command);
  }
  await assert.rejects(access(path.join(sourcePackage, "sag.fpk")));
});
