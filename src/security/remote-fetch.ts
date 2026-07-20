import { createHash } from "node:crypto";
import type { LookupAddress } from "node:dns";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpsRequest } from "node:https";

export type RemoteFetchClass = "provider_output" | "research_reference";

export type RemoteFetchPolicy = Readonly<{
  allowedContentTypes: readonly string[];
  allowedHosts: readonly string[];
  fetchClass: RemoteFetchClass;
  maximumBytes: number;
  maximumRedirects: number;
  timeoutMs: number;
}>;

export type ValidatedRemoteTarget = Readonly<{
  address: string;
  family: 4 | 6;
  hostname: string;
  resolvedAddressHashes: readonly string[];
  url: URL;
}>;

export type RemoteFetchResult = Readonly<{
  bytes: Buffer;
  canonicalUrl: string;
  contentType: string;
  redirectCount: number;
  resolvedAddressHashes: readonly string[];
  sha256: string;
}>;

export type AddressResolver = (hostname: string) => Promise<readonly LookupAddress[]>;

export class RemoteFetchPolicyError extends Error {
  override readonly name = "RemoteFetchPolicyError";

  constructor(
    message: string,
    readonly safeClass = "remote_fetch_policy_rejected",
    readonly retryable = false,
  ) {
    super(message);
  }
}

const blockedIpv4Ranges = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const;

function ipv4Number(address: string): number {
  const parts = address.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    throw new RemoteFetchPolicyError("Resolved IPv4 address is malformed.");
  }
  return (
    ((parts[0] as number) * 2 ** 24 +
      (parts[1] as number) * 2 ** 16 +
      (parts[2] as number) * 2 ** 8 +
      (parts[3] as number)) >>>
    0
  );
}

function ipv4InPrefix(address: string, base: string, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipv4Number(address) & mask) === (ipv4Number(base) & mask);
}

function ipv6BigInt(address: string): bigint {
  let input = address.toLowerCase();
  if (input.includes(".")) {
    const lastColon = input.lastIndexOf(":");
    if (lastColon < 0) throw new RemoteFetchPolicyError("IPv6 address is malformed.");
    const v4 = ipv4Number(input.slice(lastColon + 1));
    input = `${input.slice(0, lastColon)}:${((v4 >>> 16) & 0xffff).toString(16)}:${(
      v4 & 0xffff
    ).toString(16)}`;
  }
  const halves = input.split("::");
  if (halves.length > 2) throw new RemoteFetchPolicyError("IPv6 address is malformed.");
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) {
    throw new RemoteFetchPolicyError("IPv6 address is malformed.");
  }
  const parts = [...left, ...Array.from({ length: missing }, () => "0"), ...right];
  if (parts.length !== 8 || parts.some((part) => !/^[a-f0-9]{1,4}$/u.test(part))) {
    throw new RemoteFetchPolicyError("IPv6 address is malformed.");
  }
  return parts.reduce((value, part) => (value << 16n) | BigInt(`0x${part}`), 0n);
}

function ipv6InPrefix(address: bigint, base: bigint, prefix: number): boolean {
  if (prefix === 0) return true;
  const shift = BigInt(128 - prefix);
  return address >> shift === base >> shift;
}

function embeddedIpv4(address: bigint): string | null {
  const prefix = address >> 32n;
  if (prefix !== 0xffffn) return null;
  const value = Number(address & 0xffffffffn);
  return [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join(
    ".",
  );
}

export function isBlockedRemoteAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    return blockedIpv4Ranges.some(([base, prefix]) =>
      ipv4InPrefix(address, base, prefix),
    );
  }
  if (family !== 6) return true;
  const value = ipv6BigInt(address);
  const mapped = embeddedIpv4(value);
  if (mapped) return isBlockedRemoteAddress(mapped);
  return (
    value === 0n ||
    value === 1n ||
    ipv6InPrefix(value, ipv6BigInt("fc00::"), 7) ||
    ipv6InPrefix(value, ipv6BigInt("fe80::"), 10) ||
    ipv6InPrefix(value, ipv6BigInt("ff00::"), 8) ||
    ipv6InPrefix(value, ipv6BigInt("2001:db8::"), 32)
  );
}

function validatePolicy(policy: RemoteFetchPolicy): void {
  if (
    policy.allowedHosts.length < 1 ||
    policy.allowedHosts.length > 64 ||
    policy.allowedContentTypes.length < 1 ||
    policy.allowedContentTypes.length > 16 ||
    !Number.isSafeInteger(policy.maximumBytes) ||
    policy.maximumBytes < 1 ||
    policy.maximumBytes > 100 * 1024 * 1024 ||
    !Number.isSafeInteger(policy.maximumRedirects) ||
    policy.maximumRedirects < 0 ||
    policy.maximumRedirects > 5 ||
    !Number.isSafeInteger(policy.timeoutMs) ||
    policy.timeoutMs < 1_000 ||
    policy.timeoutMs > 120_000
  ) {
    throw new RemoteFetchPolicyError("Remote fetch policy is invalid.");
  }
}

export function parseRemoteFetchUrl(rawUrl: string, policy: RemoteFetchPolicy): URL {
  validatePolicy(policy);
  if (
    typeof rawUrl !== "string" ||
    rawUrl.length < 1 ||
    rawUrl.length > 2_048 ||
    /[\u0000-\u0020\u007f]/u.test(rawUrl) ||
    !rawUrl.startsWith("https://")
  ) {
    throw new RemoteFetchPolicyError("Remote URL is invalid.");
  }
  const authority = /^https:\/\/([^/?#]+)/u.exec(rawUrl)?.[1] ?? "";
  if (!authority || authority.includes("%") || authority.includes("\\")) {
    throw new RemoteFetchPolicyError("Remote URL authority is ambiguous.");
  }
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new RemoteFetchPolicyError("Remote URL is malformed.");
  }
  const hostname = url.hostname.toLowerCase();
  const allowlist = policy.allowedHosts.map((host) => host.toLowerCase());
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== "443") ||
    !hostname ||
    hostname.endsWith(".") ||
    isIP(hostname) !== 0 ||
    !/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/u.test(hostname) ||
    !allowlist.includes(hostname)
  ) {
    throw new RemoteFetchPolicyError("Remote URL is outside the exact host policy.");
  }
  return url;
}

const defaultResolver: AddressResolver = async (hostname) =>
  dnsLookup(hostname, { all: true, verbatim: true });

export async function resolveRemoteFetchTarget(
  rawUrl: string,
  policy: RemoteFetchPolicy,
  resolver: AddressResolver = defaultResolver,
): Promise<ValidatedRemoteTarget> {
  const url = parseRemoteFetchUrl(rawUrl, policy);
  let addresses: readonly LookupAddress[];
  try {
    addresses = await resolver(url.hostname);
  } catch {
    throw new RemoteFetchPolicyError(
      "Remote hostname resolution failed.",
      "remote_fetch_dns_failed",
      true,
    );
  }
  if (
    addresses.length < 1 ||
    addresses.length > 16 ||
    addresses.some(
      ({ address, family }) =>
        (family !== 4 && family !== 6) ||
        isIP(address) !== family ||
        isBlockedRemoteAddress(address),
    )
  ) {
    throw new RemoteFetchPolicyError("Remote hostname resolved to a blocked address.");
  }
  const selected = addresses[0] as LookupAddress;
  return Object.freeze({
    address: selected.address,
    family: selected.family as 4 | 6,
    hostname: url.hostname,
    resolvedAddressHashes: Object.freeze(
      addresses
        .map(({ address }) => createHash("sha256").update(address).digest("hex"))
        .sort(),
    ),
    url,
  });
}

export async function validateRemoteRedirectChain(
  urls: readonly string[],
  policy: RemoteFetchPolicy,
  resolver: AddressResolver = defaultResolver,
): Promise<readonly ValidatedRemoteTarget[]> {
  if (urls.length < 1 || urls.length - 1 > policy.maximumRedirects) {
    throw new RemoteFetchPolicyError("Remote redirect limit was exceeded.");
  }
  const result: ValidatedRemoteTarget[] = [];
  for (const url of urls) {
    result.push(await resolveRemoteFetchTarget(url, policy, resolver));
  }
  return Object.freeze(result);
}

async function fetchHop(
  target: ValidatedRemoteTarget,
  policy: RemoteFetchPolicy,
): Promise<{
  body: Buffer;
  contentType: string;
  location: string | null;
  status: number;
}> {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      target.url,
      {
        headers: {
          Accept: policy.allowedContentTypes.join(", "),
          "User-Agent": "Genie-Secure-Ingest/1",
        },
        lookup: (_hostname, _options, callback) =>
          callback(null, target.address, target.family),
        method: "GET",
        timeout: policy.timeoutMs,
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const location =
          typeof response.headers.location === "string"
            ? response.headers.location
            : null;
        const contentType = String(response.headers["content-type"] ?? "")
          .split(";", 1)[0]!
          .trim()
          .toLowerCase();
        if ([301, 302, 303, 307, 308].includes(status)) {
          response.resume();
          resolve({ body: Buffer.alloc(0), contentType, location, status });
          return;
        }
        if (status < 200 || status >= 300) {
          response.resume();
          reject(
            new RemoteFetchPolicyError(
              "Remote fetch returned a non-success status.",
              "remote_fetch_http_failed",
              true,
            ),
          );
          return;
        }
        if (!policy.allowedContentTypes.includes(contentType)) {
          response.resume();
          reject(new RemoteFetchPolicyError("Remote content type is not allowlisted."));
          return;
        }
        const declared = response.headers["content-length"];
        const declaredBytes = declared === undefined ? null : Number(declared);
        if (
          declaredBytes !== null &&
          (!Number.isSafeInteger(declaredBytes) ||
            declaredBytes < 0 ||
            declaredBytes > policy.maximumBytes)
        ) {
          response.destroy();
          reject(new RemoteFetchPolicyError("Remote content length is invalid."));
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        response.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > policy.maximumBytes) {
            response.destroy(new RemoteFetchPolicyError("Remote body is too large."));
          } else {
            chunks.push(Buffer.from(chunk));
          }
        });
        response.on("end", () => {
          if (declaredBytes !== null && total !== declaredBytes) {
            reject(
              new RemoteFetchPolicyError(
                "Remote body length did not match.",
                "remote_fetch_body_truncated",
                true,
              ),
            );
            return;
          }
          resolve({
            body: Buffer.concat(chunks, total),
            contentType,
            location,
            status,
          });
        });
        response.on("error", (error) =>
          reject(
            error instanceof RemoteFetchPolicyError
              ? error
              : new RemoteFetchPolicyError(
                  "Remote response failed.",
                  "remote_fetch_network_failed",
                  true,
                ),
          ),
        );
      },
    );
    request.on("timeout", () =>
      request.destroy(
        new RemoteFetchPolicyError(
          "Remote fetch timed out.",
          "remote_fetch_timeout",
          true,
        ),
      ),
    );
    request.on("error", (error) =>
      reject(
        error instanceof RemoteFetchPolicyError
          ? error
          : new RemoteFetchPolicyError(
              "Remote request failed.",
              "remote_fetch_network_failed",
              true,
            ),
      ),
    );
    request.end();
  });
}

export async function fetchRemoteToQuarantineBuffer(
  rawUrl: string,
  policy: RemoteFetchPolicy,
  resolver: AddressResolver = defaultResolver,
): Promise<RemoteFetchResult> {
  let currentUrl = rawUrl;
  const resolvedAddressHashes = new Set<string>();
  for (
    let redirectCount = 0;
    redirectCount <= policy.maximumRedirects;
    redirectCount += 1
  ) {
    const target = await resolveRemoteFetchTarget(currentUrl, policy, resolver);
    for (const hash of target.resolvedAddressHashes) {
      resolvedAddressHashes.add(hash);
    }
    const response = await fetchHop(target, policy);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (!response.location || redirectCount === policy.maximumRedirects) {
        throw new RemoteFetchPolicyError("Remote redirect is invalid or excessive.");
      }
      currentUrl = new URL(response.location, target.url).toString();
      continue;
    }
    return Object.freeze({
      bytes: response.body,
      canonicalUrl: target.url.toString(),
      contentType: response.contentType,
      redirectCount,
      resolvedAddressHashes: Object.freeze([...resolvedAddressHashes].sort()),
      sha256: createHash("sha256").update(response.body).digest("hex"),
    });
  }
  throw new RemoteFetchPolicyError("Remote redirect limit was exceeded.");
}
