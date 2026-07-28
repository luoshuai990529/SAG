import { afterEach, describe, expect, it, vi } from "vitest";

const originalApiBase = process.env.NEXT_PUBLIC_API_BASE;

async function attachmentUrl(): Promise<string> {
  vi.resetModules();
  const { api } = await import("./api");
  return api.attachmentUrl("document-id");
}

afterEach(() => {
  if (originalApiBase === undefined) {
    delete process.env.NEXT_PUBLIC_API_BASE;
  } else {
    process.env.NEXT_PUBLIC_API_BASE = originalApiBase;
  }
  vi.unstubAllGlobals();
});

describe("resolveApiBase", () => {
  it("uses an empty base for a slash configuration so API paths stay same-origin", async () => {
    process.env.NEXT_PUBLIC_API_BASE = "/";

    expect(await attachmentUrl()).toBe("/api/v1/attachments/document-id");
  });

  it("keeps the configured localhost base when opened locally", async () => {
    process.env.NEXT_PUBLIC_API_BASE = "http://localhost:8000";
    vi.stubGlobal("window", { location: { protocol: "http:", hostname: "localhost" } });

    expect(await attachmentUrl()).toBe("http://localhost:8000/api/v1/attachments/document-id");
  });

  it("keeps the LAN fallback to the current host API port", async () => {
    delete process.env.NEXT_PUBLIC_API_BASE;
    vi.stubGlobal("window", { location: { protocol: "http:", hostname: "192.168.1.42" } });

    expect(await attachmentUrl()).toBe("http://192.168.1.42:8000/api/v1/attachments/document-id");
  });
});
