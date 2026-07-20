import { describe, expect, it } from "vitest";

import {
  isBlockedRemoteAddress,
  parseRemoteFetchUrl,
  RemoteFetchPolicyError,
  resolveRemoteFetchTarget,
  validateRemoteRedirectChain,
  type AddressResolver,
  type RemoteFetchPolicy,
} from "./remote-fetch";

const policy: RemoteFetchPolicy = {
  allowedContentTypes: ["image/jpeg", "image/png", "image/webp"],
  allowedHosts: ["cdn.provider.example", "research.example"],
  fetchClass: "provider_output",
  maximumBytes: 25 * 1024 * 1024,
  maximumRedirects: 3,
  timeoutMs: 30_000,
};

describe("remote fetch and SSRF policy", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "100.64.0.1",
    "169.254.169.254",
    "172.31.0.1",
    "192.168.1.1",
    "198.51.100.2",
    "203.0.113.8",
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
    "ff02::1",
    "2001:db8::1",
  ])("blocks non-public address %s", (address) => {
    expect(isBlockedRemoteAddress(address)).toBe(true);
  });

  it.each([
    "http://cdn.provider.example/a.png",
    "https://user:pass@cdn.provider.example/a.png",
    "https://cdn.provider.example/a.png#token",
    "https://cdn.provider.example:8443/a.png",
    "https://127.0.0.1/a.png",
    "https://169.254.169.254/latest/meta-data",
    "https://0x7f000001/a.png",
    "https://2130706433/a.png",
    "https://cdn%2eprovider.example/a.png",
    "https://evil.example/a.png",
  ])("rejects ambiguous or out-of-policy URL %s", (url) => {
    expect(() => parseRemoteFetchUrl(url, policy)).toThrow(RemoteFetchPolicyError);
  });

  it("pins an exact public resolution", async () => {
    const resolver: AddressResolver = async () => [
      { address: "8.8.8.8", family: 4 },
      { address: "2606:4700:4700::1111", family: 6 },
    ];
    const target = await resolveRemoteFetchTarget(
      "https://cdn.provider.example/a.png?signature=opaque",
      policy,
      resolver,
    );
    expect(target.address).toBe("8.8.8.8");
    expect(target.hostname).toBe("cdn.provider.example");
    expect(target.resolvedAddressHashes).toHaveLength(2);
    expect(target.resolvedAddressHashes[0]).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects any blocked answer, including mixed public/private DNS", async () => {
    const resolver: AddressResolver = async () => [
      { address: "8.8.8.8", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ];
    await expect(
      resolveRemoteFetchTarget("https://cdn.provider.example/a.png", policy, resolver),
    ).rejects.toThrow("blocked address");
  });

  it("re-resolves and rejects DNS rebinding at a redirect hop", async () => {
    let call = 0;
    const resolver: AddressResolver = async () => {
      call += 1;
      return [
        call === 1
          ? { address: "8.8.8.8", family: 4 }
          : { address: "10.0.0.8", family: 4 },
      ];
    };
    await expect(
      validateRemoteRedirectChain(
        ["https://cdn.provider.example/start", "https://research.example/redirected"],
        policy,
        resolver,
      ),
    ).rejects.toThrow("blocked address");
    expect(call).toBe(2);
  });
});
