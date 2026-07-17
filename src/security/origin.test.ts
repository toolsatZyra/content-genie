import { describe, expect, it } from "vitest";

import { isTrustedMutationOrigin } from "@/security/origin";

describe("mutation origin", () => {
  it("allows the request and configured application origins", () => {
    expect(
      isTrustedMutationOrigin(
        "https://genie.example/path",
        "https://genie.example",
        null,
      ),
    ).toBe(true);
    expect(
      isTrustedMutationOrigin(
        "https://preview.example",
        "http://localhost:3000",
        "https://preview.example/app",
      ),
    ).toBe(true);
  });

  it("rejects missing, malformed and foreign origins", () => {
    expect(isTrustedMutationOrigin(null, "https://genie.example", null)).toBe(false);
    expect(isTrustedMutationOrigin("not a url", "https://genie.example", null)).toBe(
      false,
    );
    expect(
      isTrustedMutationOrigin(
        "https://attacker.example",
        "https://genie.example",
        null,
      ),
    ).toBe(false);
  });
});
