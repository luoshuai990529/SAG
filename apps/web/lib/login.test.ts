import { describe, expect, it } from "vitest";

import { buildLoginRequest } from "./login";

describe("buildLoginRequest", () => {
  it("preserves the legacy name-only request when optional credentials are blank", () => {
    expect(buildLoginRequest("  Ada  ", "", "   ")).toEqual({ name: "Ada" });
  });

  it("sends production password and bootstrap credentials without altering the password", () => {
    expect(
      buildLoginRequest(" Ada ", "  long passphrase  ", "  bootstrap-token  "),
    ).toEqual({
      name: "Ada",
      password: "  long passphrase  ",
      bootstrap_token: "bootstrap-token",
    });
  });
});
