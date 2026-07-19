import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";

import {
  LIVE_BROKER_PUBLIC_KEY_SPKI_BASE64,
  LIVE_BROKER_SIGNING_PRIVATE_KEY_ENV,
  liveBrokerPublicKey,
  signLiveBrokerBody,
} from "./live-broker-signing.mjs";

const fixture = generateKeyPairSync("ed25519");
const fixturePrivateKey = fixture.privateKey
  .export({ format: "der", type: "pkcs8" })
  .toString("base64");
assert.notEqual(
  liveBrokerPublicKey(fixturePrivateKey),
  LIVE_BROKER_PUBLIC_KEY_SPKI_BASE64,
);
assert.throws(
  () =>
    signLiveBrokerBody("{}", "fixture-management-authority", {
      privateKeyPkcs8Base64: fixturePrivateKey,
    }),
  /does not match the deployed public key/,
);

const previousSigner = process.env[LIVE_BROKER_SIGNING_PRIVATE_KEY_ENV];
delete process.env[LIVE_BROKER_SIGNING_PRIVATE_KEY_ENV];
assert.throws(
  () => signLiveBrokerBody("{}", "fixture-management-authority"),
  /dedicated signing authority is unavailable/,
);
if (previousSigner === undefined) {
  delete process.env[LIVE_BROKER_SIGNING_PRIVATE_KEY_ENV];
} else {
  process.env[LIVE_BROKER_SIGNING_PRIVATE_KEY_ENV] = previousSigner;
}

const source = await import("node:fs/promises").then(({ readFile }) =>
  readFile(new URL("./live-broker-signing.mjs", import.meta.url), "utf8"),
);
assert.doesNotMatch(source, /privateKeyFromAccessToken|genie-live-broker-v1\\0/);
assert.match(source, /GENIE_LIVE_BROKER_SIGNING_PRIVATE_KEY_PKCS8_BASE64/);
assert.match(source, /asymmetricKeyType !== "ed25519"/);

const contract = await import("node:fs/promises").then(({ readFile }) =>
  readFile(new URL("../src/server/live-broker-contract.ts", import.meta.url), "utf8"),
);
assert.match(
  contract,
  new RegExp(LIVE_BROKER_PUBLIC_KEY_SPKI_BASE64.replaceAll("+", "\\+")),
);

if (previousSigner) {
  assert.equal(liveBrokerPublicKey(previousSigner), LIVE_BROKER_PUBLIC_KEY_SPKI_BASE64);
  const signedWithFirstAuthority = signLiveBrokerBody("{}", "first-authority", {
    issuedAt: "1760000000000",
    nonce: "12345678-1234-4123-8123-123456789abc",
    privateKeyPkcs8Base64: previousSigner,
  });
  const signedWithSecondAuthority = signLiveBrokerBody("{}", "second-authority", {
    issuedAt: "1760000000000",
    nonce: "12345678-1234-4123-8123-123456789abc",
    privateKeyPkcs8Base64: previousSigner,
  });
  assert.deepEqual(signedWithFirstAuthority, signedWithSecondAuthority);
}

console.log("PASS dedicated live-broker Ed25519 signer and fail-closed key binding");
