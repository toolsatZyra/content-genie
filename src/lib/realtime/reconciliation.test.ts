import { describe, expect, it } from "vitest";

import { shouldReconcileRealtimeStatus } from "@/lib/realtime/reconciliation";

describe("Realtime projection reconciliation", () => {
  it.each(["SUBSCRIBED", "CHANNEL_ERROR", "TIMED_OUT", "CLOSED"] as const)(
    "refreshes the authoritative projection after %s",
    (status) => {
      expect(shouldReconcileRealtimeStatus(status)).toBe(true);
    },
  );
});
