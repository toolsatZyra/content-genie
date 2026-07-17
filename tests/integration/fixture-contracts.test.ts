import { describe, expect, it } from "vitest";

import mediaFixtures from "../fixtures/media/safe-probes.json";
import webhookFixtures from "../fixtures/webhooks/provider-cases.json";

function probePng(base64: string): {
  height?: number;
  safe: boolean;
  width?: number;
} {
  const bytes = Buffer.from(base64, "base64");
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature)) {
    return { safe: false };
  }
  return {
    height: bytes.readUInt32BE(20),
    safe: true,
    width: bytes.readUInt32BE(16),
  };
}

describe("deterministic provider fixtures", () => {
  it("keeps webhook replay, cancellation and signature cases structurally valid", () => {
    expect(webhookFixtures.schemaVersion).toBe("provider-webhook-fixtures.v1");
    expect(webhookFixtures.cases.map(({ name }) => name)).toEqual([
      "signed-success",
      "duplicate-delivery",
      "late-after-cancel",
      "invalid-signature",
    ]);
    expect(webhookFixtures.cases[0]?.deliveryId).toBe(
      webhookFixtures.cases[1]?.deliveryId,
    );
    expect(webhookFixtures.cases.at(-1)?.state).toBe("failed_terminal");
    for (const fixture of webhookFixtures.cases) {
      expect(fixture.deliveryId).toMatch(/^delivery_\d{6}$/);
      expect(fixture.providerRequestId).toMatch(/^provider_\d{6}$/);
      expect(["succeeded", "failed_terminal"]).toContain(fixture.state);
    }
  });

  it("proves safe media bytes rather than trusting the declared content type", () => {
    expect(mediaFixtures.schemaVersion).toBe("media-probe-fixtures.v1");
    for (const fixture of mediaFixtures.fixtures) {
      const probe = probePng(fixture.base64);
      expect(probe.safe, fixture.name).toBe(fixture.expected.safe);
      if ("width" in fixture.expected) {
        expect(probe.width, fixture.name).toBe(fixture.expected.width);
        expect(probe.height, fixture.name).toBe(fixture.expected.height);
      }
    }
  });
});
