import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const sourceConfig = path.join(repoRoot, "deploy/fnos/nginx.conf");
const packageConfig = path.join(repoRoot, "packages/fnos/sag/app/docker/nginx.conf");

test("source and packaged gateways apply conservative per-peer auth throttling", async () => {
  const source = await readFile(sourceConfig, "utf8");
  const packaged = await readFile(packageConfig, "utf8");
  assert.equal(packaged, source);

  assert.match(
    source,
    /limit_req_zone\s+\$binary_remote_addr\s+zone=sag_auth:[^;]+\s+rate=5r\/m;/,
  );
  assert.match(
    source,
    /location\s+~\s+\^\/api\/v1\/auth\/\(login\|register\)\/\?\$/,
  );
  assert.match(source, /limit_req\s+zone=sag_auth\s+burst=3\s+nodelay;/);
  assert.match(source, /limit_req_status\s+429;/);
  assert.match(source, /error_page\s+429\s+=\s+@sag_auth_limited;/);
  assert.match(
    source,
    /location\s+@sag_auth_limited\s*\{[\s\S]*add_header\s+Retry-After\s+"60"\s+always;[\s\S]*return\s+429;/,
  );
  assert.doesNotMatch(source, /limit_req_zone\s+\$http_x_forwarded_for/);
  assert.doesNotMatch(source, /set_real_ip_from|real_ip_header/);
});
