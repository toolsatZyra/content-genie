import { describe, expect, it } from "vitest";

import {
  BoundedResponseBodyError,
  readJsonResponseBounded,
  readResponseBodyBounded,
} from "./bounded-response-body";

describe("bounded response body reader", () => {
  it("streams a response without Content-Length inside the byte limit", async () => {
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2]));
          controller.enqueue(new Uint8Array([3, 4]));
          controller.close();
        },
      }),
    );

    await expect(readResponseBodyBounded(response, 4)).resolves.toEqual(
      Buffer.from([1, 2, 3, 4]),
    );
  });

  it("cancels an undeclared stream as soon as it crosses the byte limit", async () => {
    let cancelled = false;
    const response = new Response(
      new ReadableStream({
        cancel() {
          cancelled = true;
        },
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
          controller.enqueue(new Uint8Array([4, 5, 6]));
        },
      }),
    );

    await expect(readResponseBodyBounded(response, 5)).rejects.toBeInstanceOf(
      BoundedResponseBodyError,
    );
    expect(cancelled).toBe(true);
  });

  it("rejects an oversized or inconsistent Content-Length before trusting bytes", async () => {
    await expect(
      readResponseBodyBounded(
        new Response(Buffer.alloc(8), { headers: { "content-length": "8" } }),
        7,
      ),
    ).rejects.toThrow(/byte limit/u);
    await expect(
      readResponseBodyBounded(
        new Response(Buffer.alloc(4), { headers: { "content-length": "3" } }),
        4,
      ),
    ).rejects.toThrow(/length declaration/u);
  });

  it("parses JSON only after the complete body satisfies the byte contract", async () => {
    await expect(
      readJsonResponseBounded(new Response('{"status":"COMPLETED"}'), 64),
    ).resolves.toEqual({ status: "COMPLETED" });
    await expect(readJsonResponseBounded(new Response("{"), 64)).rejects.toBeInstanceOf(
      BoundedResponseBodyError,
    );
  });
});
