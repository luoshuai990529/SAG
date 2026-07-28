#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const defaultCompose = "packages/fnos/sag/docker-compose.yml";
const composePath = path.resolve(process.cwd(), process.argv[2] || defaultCompose);
const immutableDigest = /@sha256:[a-f0-9]{64}$/i;
const requiredSecretReference = /^\$\{SAG_SECRET_KEY:?\?[^}]*\}$/;
const fnosSecretEnvFile = "${TRIM_PKGETC}/sag.env";

function fail(messages) {
  for (const message of messages) console.error(`release-compose: ${message}`);
  process.exit(1);
}

function loadCompose(file) {
  const result = spawnSync(
    "docker",
    ["compose", "-f", file, "config", "--no-interpolate", "--no-path-resolution", "--format", "json"],
    { encoding: "utf8" },
  );
  if (result.error) {
    fail([`could not run docker compose: ${result.error.message}`]);
  }
  if (result.status !== 0) {
    fail([`could not parse ${file}: ${result.stderr.trim() || result.stdout.trim()}`]);
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    fail([`docker compose did not return JSON for ${file}: ${error.message}`]);
  }
}

function validateImage(name, service, errors) {
  if (Object.hasOwn(service, "build")) {
    errors.push(`${name} must not define build in a release Compose file`);
  }
  if (typeof service.image !== "string") {
    errors.push(`${name} must define an image pinned by digest`);
    return;
  }
  if (/:latest(?:@|$)/.test(service.image)) {
    errors.push(`${name} must not use the latest tag`);
  }
  if (!immutableDigest.test(service.image)) {
    errors.push(`${name} image must use an immutable sha256 digest`);
  }
}

function hasFnosSecretEnvFile(api) {
  return Array.isArray(api.env_file) && api.env_file.some((entry) => (
    entry === fnosSecretEnvFile
    || (entry && typeof entry === "object" && entry.path === fnosSecretEnvFile)
  ));
}

function validateApiSecret(api, errors) {
  const secret = api.environment?.SAG_SECRET_KEY;
  if (typeof secret === "string" && requiredSecretReference.test(secret)) return;
  if (secret === undefined && hasFnosSecretEnvFile(api)) return;
  if (typeof secret === "string") {
    errors.push("api must use a required SAG_SECRET_KEY reference, not a literal secret");
  } else {
    errors.push("api must use a required SAG_SECRET_KEY reference or ${TRIM_PKGETC}/sag.env");
  }
}

function validateNoHostPorts(name, service, errors) {
  if (Array.isArray(service.ports) && service.ports.length > 0) {
    errors.push(`${name} must not publish host ports in a release Compose file`);
  }
}

function validate(compose) {
  const errors = [];
  const services = compose.services;
  if (!services || typeof services !== "object") return ["Compose must define services"];

  for (const [name, service] of Object.entries(services)) {
    if (!service || typeof service !== "object") {
      errors.push(`${name} must be a service object`);
      continue;
    }
    validateImage(name, service, errors);
  }

  for (const name of ["api", "web"]) {
    if (!services[name] || typeof services[name] !== "object") {
      errors.push(`Compose must define the ${name} service`);
      continue;
    }
    validateNoHostPorts(name, services[name], errors);
  }
  if (services.api && typeof services.api === "object") validateApiSecret(services.api, errors);
  return errors;
}

const errors = validate(loadCompose(composePath));
if (errors.length) fail(errors);
console.log(`release Compose validation passed: ${composePath}`);
