import assert from "node:assert/strict";
import test from "node:test";

import {
  validateGatewayImageReference,
  validateGatewayIndex,
  validateGatewayPolicy,
} from "../fnos-gateway-policy.mjs";

const digest = "sha256:97d490c12ba55b4946b01546d1c3ed324e8d41ab1c9fcb2a616aa470620e5b46";
const revision = "ccdab6c99ae2e2fc53a144dc68d6b8f44163adf2";
const reference = `docker.io/library/nginx:1.30.4-alpine@${digest}`;

function reviewedPolicy(overrides = {}) {
  return {
    schemaVersion: 1,
    image: {
      repository: "docker.io/library/nginx",
      tag: "1.30.4-alpine",
      indexDigest: digest,
      reference,
    },
    requiredPlatforms: [
      {
        os: "linux",
        architecture: "amd64",
        manifestDigest: `sha256:${"8".repeat(64)}`,
        upstreamRevision: revision,
      },
      {
        os: "linux",
        architecture: "arm64",
        manifestDigest: `sha256:${"d".repeat(64)}`,
        upstreamRevision: revision,
      },
    ],
    review: {
      reviewedOn: "2026-07-29",
      expiresOn: "2026-08-28",
      maximumAgeDays: 30,
    },
    vulnerabilityGate: {
      scanner: "aquasecurity/trivy",
      scannerVersion: "0.70.0",
      linuxAmd64ArchiveSha256: "8b4376d5d6befe5c24d503f10ff136d9e0c49f9127a4279fd110b727929a5aa9",
      macosArm64ArchiveSha256: "68e543c51dcc96e1c344053a4fde9660cf602c25565d9f09dc17dd41e13b838a",
      platform: "linux/amd64",
      severities: ["CRITICAL", "HIGH"],
      ignoreUnfixed: true,
      exitCodeOnFindings: 1,
      scannedAt: "2026-07-29T16:33:41+08:00",
      result: "passed",
      fixableFindings: 0,
      imageId: `sha256:${"6".repeat(64)}`,
      os: { family: "alpine", version: "3.24.1" },
      sourceReportSha256: "9".repeat(64),
    },
    ...overrides,
  };
}

function reviewedIndex({ amd64Revision = revision, amd64Digest = `sha256:${"8".repeat(64)}` } = {}) {
  return {
    schemaVersion: 2,
    mediaType: "application/vnd.oci.image.index.v1+json",
    manifests: [
      {
        digest: amd64Digest,
        platform: { os: "linux", architecture: "amd64" },
        annotations: {
          "org.opencontainers.image.revision": amd64Revision,
          "org.opencontainers.image.version": "1.30.4-alpine",
        },
      },
      {
        digest: `sha256:${"d".repeat(64)}`,
        platform: { os: "linux", architecture: "arm64", variant: "v8" },
        annotations: {
          "org.opencontainers.image.revision": revision,
          "org.opencontainers.image.version": "1.30.4-alpine",
        },
      },
    ],
  };
}

test("accepts a current reviewed gateway policy and its exact OCI index metadata", () => {
  const policy = reviewedPolicy();
  assert.equal(validateGatewayPolicy(policy, new Date("2026-07-29T12:00:00Z")), reference);
  assert.doesNotThrow(() => validateGatewayIndex(policy, reviewedIndex()));
});

test("rejects an arbitrary Nginx digest that was not reviewed", () => {
  assert.throws(
    () => validateGatewayImageReference(
      reviewedPolicy(),
      `docker.io/library/nginx:1.30.4-alpine@sha256:${"f".repeat(64)}`,
    ),
    /reviewed gateway reference/i,
  );
});

test("rejects a gateway policy without recorded scanner approval", () => {
  const policy = reviewedPolicy({
    vulnerabilityGate: {
      ...reviewedPolicy().vulnerabilityGate,
      result: "pending",
    },
  });
  assert.throws(() => validateGatewayPolicy(policy, new Date("2026-07-29T12:00:00Z")), /scan.*passed/i);
});

test("rejects scanner approval without exact artifact evidence", () => {
  const policy = reviewedPolicy({
    vulnerabilityGate: {
      ...reviewedPolicy().vulnerabilityGate,
      sourceReportSha256: undefined,
    },
  });
  assert.throws(
    () => validateGatewayPolicy(policy, new Date("2026-07-29T12:00:00Z")),
    /source report sha-256/i,
  );
});

test("rejects an expired gateway review", () => {
  assert.throws(
    () => validateGatewayPolicy(reviewedPolicy(), new Date("2026-08-29T00:00:00Z")),
    /expired/i,
  );
});

test("rejects a review window wider than the hard thirty-day bound", () => {
  const policy = reviewedPolicy({
    review: {
      reviewedOn: "2026-07-29",
      expiresOn: "2026-09-01",
      maximumAgeDays: 34,
    },
  });
  assert.throws(() => validateGatewayPolicy(policy, new Date("2026-07-29T12:00:00Z")), /30 days/i);
});

test("rejects raw platform metadata whose manifest digest differs from the review", () => {
  assert.throws(
    () => validateGatewayIndex(reviewedPolicy(), reviewedIndex({ amd64Digest: `sha256:${"a".repeat(64)}` })),
    /linux\/amd64.*manifest digest/i,
  );
});

test("rejects raw platform metadata whose upstream revision differs from the review", () => {
  assert.throws(
    () => validateGatewayIndex(reviewedPolicy(), reviewedIndex({ amd64Revision: "0".repeat(40) })),
    /linux\/amd64.*upstream revision/i,
  );
});
