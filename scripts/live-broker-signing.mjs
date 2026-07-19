import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomUUID,
  sign,
} from "node:crypto";

export const LIVE_BROKER_PUBLIC_KEY_SPKI_BASE64 =
  "MCowBQYDK2VwAyEAQWlCcHOTC+evpLw+iL09TrOsz807JdXg6mYeeqUa0NM=";
export const LIVE_BROKER_SIGNING_PRIVATE_KEY_ENV =
  "GENIE_LIVE_BROKER_SIGNING_PRIVATE_KEY_PKCS8_BASE64";

function signerPrivateKey(privateKeyPkcs8Base64) {
  if (
    typeof privateKeyPkcs8Base64 !== "string" ||
    !/^[A-Za-z0-9+/]{60,160}={0,2}$/u.test(privateKeyPkcs8Base64.trim())
  ) {
    throw new Error("Live-broker dedicated signing authority is unavailable.");
  }
  let privateKey;
  try {
    privateKey = createPrivateKey({
      format: "der",
      key: Buffer.from(privateKeyPkcs8Base64.trim(), "base64"),
      type: "pkcs8",
    });
  } catch {
    throw new Error("Live-broker dedicated signing authority is invalid.");
  }
  if (privateKey.asymmetricKeyType !== "ed25519") {
    throw new Error("Live-broker dedicated signing authority is not Ed25519.");
  }
  return privateKey;
}

export function liveBrokerPublicKey(privateKeyPkcs8Base64) {
  return createPublicKey(signerPrivateKey(privateKeyPkcs8Base64))
    .export({ format: "der", type: "spki" })
    .toString("base64");
}

export function liveBrokerSignaturePayload(rawBody, issuedAt, nonce) {
  const bodySha256 = createHash("sha256").update(rawBody).digest("hex");
  return Buffer.from(
    `genie-live-broker-signature.v1\n${issuedAt}\n${nonce}\n${bodySha256}`,
    "utf8",
  );
}

export function signLiveBrokerBody(
  rawBody,
  _branchManagementAuthority,
  {
    issuedAt = String(Date.now()),
    nonce = randomUUID(),
    privateKeyPkcs8Base64 = process.env[LIVE_BROKER_SIGNING_PRIVATE_KEY_ENV],
  } = {},
) {
  const privateKey = signerPrivateKey(privateKeyPkcs8Base64);
  const publicKey = createPublicKey(privateKey)
    .export({ format: "der", type: "spki" })
    .toString("base64");
  if (publicKey !== LIVE_BROKER_PUBLIC_KEY_SPKI_BASE64) {
    throw new Error(
      "The dedicated live-broker signer does not match the deployed public key.",
    );
  }
  if (!/^[0-9]{13}$/.test(issuedAt)) {
    throw new Error("The live-broker signing timestamp is invalid.");
  }
  if (!/^[0-9a-f-]{36}$/i.test(nonce)) {
    throw new Error("The live-broker signing nonce is invalid.");
  }
  return Object.freeze({
    issuedAt,
    nonce,
    signature: sign(
      null,
      liveBrokerSignaturePayload(rawBody, issuedAt, nonce),
      privateKey,
    ).toString("base64"),
  });
}
