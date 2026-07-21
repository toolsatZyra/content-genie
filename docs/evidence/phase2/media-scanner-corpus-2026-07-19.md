# Phase 2 isolated media-scanner corpus evidence

**Latest run date:** 2026-07-21
**Candidate:** `49dc7ea8c2e7d85857660e775b2bed575616aa5e` plus the intentional Phase 2/MVP worktree
**Scope:** `P2-07`, `V-P2-008`, `V-P2-011`, and `V-P2-012`
**Disposition:** focused proof passed; complete frozen-candidate gate remains required

## Boundary under test

`scanAndReencodeWorldImage` creates an ephemeral, non-persistent Vercel
Sandbox, installs ClamAV and ImageMagick before receiving untrusted bytes,
updates signatures, switches the sandbox network policy to `deny-all`, writes
the quarantined source, scans and probes it, re-encodes a single frame with
metadata stripping, probes the derivative, and stops the sandbox in `finally`.

The pre-sandbox boundary independently sniffs media magic, enforces the 25 MiB
image limit, and now validates exact still-image container termination. PNG
validation also walks bounded chunks and verifies their CRCs; WebP requires an
exact RIFF length and chunk envelope; JPEG requires an exact EOI boundary.

## Deterministic negative corpus

Command:

```powershell
pnpm exec vitest run --project unit src/security/still-image-container.test.ts src/server/sandbox-media-scanner.test.ts src/app/api/cron/provider-output-ingest/route.test.ts
```

Result: 3 files and 20 tests passed. The separately credentialed live test is
recorded below. The deterministic corpus proves that:

- corrupt-CRC and truncated containers are rejected before sandbox creation;
- ZIP/appended-payload PNG, JPEG, and WebP polyglots are rejected before
  sandbox creation;
- wrong-MIME and oversized bytes are rejected before sandbox creation;
- malformed, wrong-MIME, and oversized provider output is failed safely and
  never promoted;
- a malformed container that has already entered quarantine remains
  non-authoritative and is never promoted.

## Live isolated sanitization corpus

The live test loaded its Vercel Sandbox credential only from the ignored local
environment files already used by the repository runners. No token, provider
secret, or credential value was printed or copied into this evidence.

Command shape:

```powershell
$env:RUN_LIVE_MEDIA_SCANNER='1'
node --env-file-if-exists=.tmp/vercel-sandbox.env --env-file-if-exists=.env.local node_modules/vitest/vitest.mjs run --project integration tests/integration/sandbox-media-scanner.live.test.ts
```

Result: 1 file and 1 live integration test passed in 48.34 seconds; the scanner
operation itself completed in 46.55 seconds. The 400x400 source PNG contained
a GPS/comment `tEXt` chunk, an XMP-like `iTXt` chunk, and a private ancillary
attachment chunk. The returned derivative had a new SHA-256, retained the exact
dimensions and valid PNG envelope, and contained none of `tEXt`, `zTXt`,
`iTXt`, `eXIf`, the private attachment chunk, GPS text, comment text, or
attachment payload. The output ended exactly at `IEND`.

This focused evidence does not independently close Phase 2. The same code and
tests must remain green in the frozen-candidate complete gate and the single
end-of-phase adversarial review.
