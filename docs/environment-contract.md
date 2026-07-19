# Genie environment and secret contract

**Status:** Implementation-plan gate passed
**Rule:** Values never appear in this document, Git, diagnostics, browser
bundles, provider prompts, or client-visible errors.

## 1. Environment classes

| Class | Location | Browser-visible | Examples |
|---|---|---:|---|
| Public application | Vercel/`.env.local` with `NEXT_PUBLIC_` | Yes | Supabase URL and publishable/anon key |
| Vercel server-only | Vercel encrypted environment | No | Supabase service role, provider adapter keys, signing authority |
| Trigger-only | Trigger.dev encrypted environment | No | exact task keys, capability verification public key |
| Local CLI only | developer environment, never Vercel runtime | No | Supabase access token, database password |
| Database configuration | versioned records without raw secrets | Server-authorized reads only | voice IDs, capability/rate rows, flags |

## 2. Current supplied variables

Only presence was inspected; values were not printed.

| Variable | Class | Launch use | Required for |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Public | Supabase project URL | browser/server client |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public | Supabase publishable/anon key | browser/server client |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel server-only | narrow server administration and signed operations | server control plane |
| `SUPABASE_ACCESS_TOKEN` | Trusted local/CI control only | Supabase integration/CLI authentication | migrations, disposable branches, scheduled branch reaping |
| `TRIGGER_SECRET_KEY` | Vercel server-only + Trigger deployment tooling | Trigger.dev SDK authentication | workflow enqueue/deploy |
| `ELEVENLABS_API_KEY` | Vercel provider broker only | narration | voice adapter |
| `FAL_KEY` | Vercel provider broker only | image/video/provider calls | Kling and fal-hosted adapters |
| `GOOGLE_GENAI_API_KEY` | Vercel provider broker only | reasoning/judging/image/video capability where enabled | configured adapters |
| `OPENAI_API_KEY` | Vercel provider broker only | reasoning/judging fallback where enabled | configured adapters |
| `ANTHROPIC_API_KEY` | Vercel provider broker only | independent judge/challenger where enabled | configured adapters |
| `SARVAM_API_KEY` | Vercel provider broker only | Hindi speech/alignment capability where enabled | configured adapter |
| `CRON_SECRET` | Vercel server-only | authenticated scheduled reconciliation | production cron |
| `GENIE_LIVE_EVIDENCE_PRIVATE_KEY_PKCS8_BASE64` | Vercel production server-only | sign deployment-, request-, and result-bound live-proof evidence | trusted live broker only |

Sentry variables remain unused and must not be added to runtime imports.

## 3. Variables to add

| Variable | Class | Purpose |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | Public | canonical application URL per environment |
| `SUPABASE_PROJECT_REF` | Local CI/deploy | explicit project selection |
| `SUPABASE_TEST_PROJECT_REF` | Local CI/deploy | isolated preview/test project; never production |
| `SUPABASE_DB_URL` | Local CI/deploy | migrations only; prefer ephemeral/pooled form appropriate to tool |
| `TRIGGER_PROJECT_REF` | Local CI/deploy | explicit Trigger.dev project selection |
| `GENIE_APPROVED_LIVE_BROKER_COMMIT` | Local CI only | independently reviewed production broker deployment pin; exact 40-character Git commit |
| `GENIE_LIVE_BRANCH_REAPER_MIN_AGE_MINUTES` | Trusted local/CI control only | optional stale orphan threshold; integer minutes, minimum 60, default 360 |
| `GENIE_LIVE_BROKER_SIGNING_PRIVATE_KEY_PKCS8_BASE64` | Protected local/CI environment only | dedicated Ed25519 request authority for the live-proof broker; independently generated and never derived from the Supabase management token |
| `GENIE_COMMAND_HMAC_SECRET` | Vercel server-only | dedicated invitation/command HMAC authority; must be independent of the Supabase service-role key |
| `GENIE_CAPABILITY_SIGNING_PRIVATE_KEY` | Vercel issuer only | sign short-lived per-attempt capability tokens |
| `GENIE_CAPABILITY_VERIFY_PUBLIC_KEY` | Vercel/Trigger verifier | verify tokens; cannot mint |
| `GENIE_BROKER_CLIENT_ID` | Each Trigger project only | stable, environment-scoped service identity; unique per Trigger project |
| `GENIE_BROKER_CLIENT_SIGNING_PRIVATE_KEY` | Each Trigger project only | sign short-lived broker-client assertions; unique Ed25519 key per project/environment |
| `GENIE_BROKER_CLIENT_PUBLIC_KEYS_JSON` | Vercel provider broker only | allowlisted `client_id`/`kid`/public-key registry during bootstrap; database registry is authoritative after bootstrap |
| `GENIE_BROKER_AUDIENCE` | Vercel broker + each Trigger project | exact provider-broker audience string |
| `FAL_CALLBACK_SECRET` | Vercel server-only, per environment | fal callback verification/correlation |
| `ELEVENLABS_CALLBACK_SECRET` | Vercel server-only, per environment | ElevenLabs callback verification/correlation if enabled |
| `GOOGLE_CALLBACK_SECRET` | Vercel server-only, per environment | Google callback verification/correlation if enabled |
| `SEEDANCE_CALLBACK_SECRET` | Vercel server-only, per environment | Seedance endpoint callback verification/correlation if distinct |
| `GENIE_DIAGNOSTIC_HASH_KEY` | Vercel + Trigger server-only | stable keyed hashing/redaction of sensitive identifiers |
| `GENIE_ENVIRONMENT` | Vercel + Trigger | `development`, `preview`, or `production` |
| `GENIE_ENABLE_PROVIDER_SPEND` | Vercel server-only | server-side kill switch; default `false` |
| `GENIE_ENABLE_RENDER` | Vercel + Trigger | server-side render kill switch; default `false` |
| `GENIE_ENABLE_EXPORT` | Vercel server-only | export kill switch |
| `GENIE_ENABLE_FINAL_APPROVAL` | Vercel server-only | disabled outside production-ready environments |
| `GENIE_VAULT_SUPABASE_URL` | Separate Vault-writer deployment | separate Vault project URL |
| `GENIE_VAULT_WRITER_DB_URL` | Separate Vault-writer deployment | custom insert-only database login; no update/delete/DDL |
| `GENIE_VAULT_WRITER_SIGNING_PRIVATE_KEY` | Separate Vault-writer issuer only | mint short-lived `genie_vault_writer` Storage JWTs |
| `GENIE_VAULT_PROJECT_REF` | Local deploy/restore | explicit independent Vault project |
| `GENIE_VAULT_RESTORE_DB_URL` | Offline restore operator only | timed restore drills; never app runtime |
| `GENIE_ALERT_WEBHOOK_URL_PRIMARY` | Alert router only | primary high-severity alert destination |
| `GENIE_ALERT_WEBHOOK_URL_FALLBACK` | Alert router only | independent fallback destination |

Secrets must be independently generated per environment and at least 32 random
bytes where used for HMAC/token signing.
The Supabase management token controls disposable branch lifecycle only. It is
never reused or transformed into broker request-signing authority.

The GitHub `Trusted live branch reaper` workflow stores
`SUPABASE_ACCESS_TOKEN` and the exact production `SUPABASE_PROJECT_REF` as
repository secrets. Scheduled and manually dispatched reaper jobs fail closed
when either value is absent or malformed. The token is supplied only to the
trusted parent process and pinned Supabase CLI; it never enters candidate
source, a candidate process, an artifact, or the production application.

## 4. Non-secret versioned configuration

Store these as immutable database configuration versions, not mutable
environment strings:

- male voice ID `b0oby86k6n7Uh5LZcOBR`;
- female voice ID `GSdeLRB8detpjZjN63Wn`;
- default narrator gender `male`;
- 117 look definitions and default `glowing-divine-realism`;
- provider capability rows and rate-card snapshots;
- model routing policy;
- rubric/config hashes;
- cost target and hard ceiling;
- cultural policy and competency versions;
- render image/ffmpeg/font/EDD compiler pins.

## 5. Validation rules

- Import public variables only through `src/config/public-env.ts`.
- Import secrets only through `src/config/server-env.ts` or
  `trigger/config.ts`, both marked server-only.
- Production boot fails closed if a required variable is missing or malformed.
- Provider flags default off when their keys or verified capability snapshots
  are missing.
- Preview and production may not share signing secrets.
- Provider callback credentials are unique per provider and environment; no
  generic shared callback secret is accepted.
- Capability tokens use issuer-only asymmetric signing. Trigger/media workers
  receive only the verification public key.
- A valid capability signature is insufficient by itself: the one-time `jti`,
  exact scope, expiry, authority epoch, fence, allowed RPC/object manifest, and
  grant status must be registered and revalidated in Postgres.
- A Trigger task calling the provider broker supplies two independent proofs:
  the registered one-attempt capability grant issued by Vercel and a
  project-specific service-identity assertion signed by that Trigger project's
  `GENIE_BROKER_CLIENT_SIGNING_PRIVATE_KEY`.
- A service-identity assertion is a JWT with an EdDSA signature, `kid`,
  `iss = GENIE_BROKER_CLIENT_ID`, `aud = GENIE_BROKER_AUDIENCE`,
  `sub = <task-id>:<run-id>:<stage-id>`, unique `jti`, `iat`, and an expiry no
  more than 60 seconds after issue. The broker rejects an unknown/disabled
  client or `kid`, wrong audience, project/environment mismatch, replayed
  `jti`, expired/not-yet-valid assertion, or subject that does not match the
  capability grant and registered attempt.
- The service-identity assertion authenticates the calling deployment only. It
  grants no provider, spend, storage, command, or approval authority without
  the separately registered capability grant, quote slot, fence, and policy
  checks.
- Vault writer authority is separate from production application authority;
  restore credentials are offline and cannot be used by the running app.
- The Vault project defines a custom `genie_vault_writer` role with INSERT-only
  grants and insert-only Storage policies. Database triggers deny
  UPDATE/DELETE/TRUNCATE for that role, and short-lived writer JWTs are
  registered by `jti`. Writer compromise cannot alter or delete prior copies.
- No Vault `service_role` or secret key is present in the running application
  or writer deployment.
- Client errors expose a correlation ID, never raw environment/provider text.
- A build-time seeded canary secret must not occur in emitted JS, source maps,
  HTML, route payloads, or public diagnostics.
- `.env*` stays ignored except a committed `.env.example` with empty values and
  comments.

## 6. Rotation and incident handling

For a suspected secret leak:

1. disable provider spend/render/export;
2. revoke/rotate the affected key;
3. invalidate signed capability/session artifacts where applicable;
4. reconcile provider jobs and billing;
5. scan Git history, deployment output, diagnostics, and storage;
6. record the incident in restricted audit;
7. re-enable only after canary verification.

The Supabase service-role key bypasses RLS and receives the strictest handling.
It is never sent to the ffmpeg/media worker when a short-lived registered
capability token and signed URLs can perform the task. Provider keys are loaded
only by the Vercel provider broker, not by any Trigger control, agent, ingest,
parser, or renderer task.

## 7. Trigger deployment isolation

Trigger environment variables are project/environment scoped, not per task.
Genie therefore uses separate deployments and no provider secrets in Trigger:

| Trigger project | Allowed secrets | Explicitly absent |
|---|---|---|
| `genie-control` | Trigger key, capability verify public key, unique broker client ID/signing key, broker audience | provider keys, Supabase service role, Vault credentials |
| `genie-agent` | Trigger key, capability verify public key, unique broker client ID/signing key, broker audience | provider keys, renderer grants, Supabase service role |
| `genie-media` | Trigger key, capability verify public key, unique broker client ID/signing key, broker audience, signed task grants | provider keys, model keys, Supabase service role |

The Vercel provider broker validates the registered one-attempt grant, exact
quote slot, capability, workspace/run/stage/fence, expiry, and broker client
identity before using a provider key. Negative deployment tests attempt to read
every provider-key name from each Trigger project and must receive absence.

Broker-client public keys are stored in a versioned server-authorized registry
with `client_id`, Trigger project, environment, `kid`, validity window, and
status. Rotation uses an explicit overlap window with two valid `kid` values;
revocation disables the compromised `kid` immediately and expires its
outstanding assertion `jti` values. No Trigger project receives another
project's private key, and no shared broker-client secret exists.
