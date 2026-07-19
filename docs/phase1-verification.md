# Phase 1 executable verification gates

These commands are destructive to test data. Run them only against the local
Supabase stack or a non-production preview branch/project.

## Disposable database and browser suite

Authenticate the Supabase CLI, select the parent project used to create preview
branches, then run:

```powershell
$env:SUPABASE_PROJECT_REF = "<parent-project-ref>"
pnpm test:live:phase1
```

The command first requires a committed, published candidate that is byte-for-byte
the independently approved production broker deployment. The local trusted
controller creates a fresh preview branch by exact ID-and-name, while the
production broker clones that same immutable commit into a Firecracker sandbox.
The committed trusted-harness manifest pins the runner, strict artifact validator,
pgTAP and hardened-query sources, migrations, predecessor fixture, live specs,
lockfile, and package-manager version. The broker verifies those hashes before
execution and validates the complete closed candidate artifact before signing it.
Candidate code receives only disposable-branch credentials; the account
management token and production database/service credentials never enter it.
Immediately after branch creation or exact-name recovery, and before readiness
or candidate execution, the trusted controller writes an exact cleanup lease to
the production-private control plane. The lease binds the branch UUID, strict
generated name, preview project ref, production parent ref, candidate commit and
tree, a unique cleanup lease UUID, and a two-hour coordinator owner lease.
Before creating another branch, every live-suite invocation reconciles its own
same-owner lease immediately and may claim another coordinator's lease only
after that lease expires. An unexpired active lease is never claimed or deleted
by a scheduled reaper or concurrent live-suite invocation.
Deletion is recorded only after the existing cleanup loop has observed three
consecutive exact-identity absence snapshots.
This is an exact-tree integrated proof with the reviewed broker tree in the
trusted computing base. It is not evidence that an arbitrary hostile candidate
was independently tested by a separate harness.
Realtime is intentionally
skipped on the new branch because a freshly reset preview branch may not have an
attached replication tenant. The suite records cleanup and forward-rollback
status in the parent-owned, closed-schema
`.tmp/artifacts/phase1-live-suite.json` artifact.

## Scheduled crash recovery

The `Trusted live branch reaper` GitHub workflow runs hourly. It intentionally
has no manual GitHub dispatch surface; an authorized operator may instead run
the repository's local `pnpm live-branch:reap` command when immediate recovery
is required. The scheduled job receives `SUPABASE_ACCESS_TOKEN` and the exact
20-character production `SUPABASE_PROJECT_REF` only from the protected
`genie-production-control` GitHub environment, whose branch policy admits only
`main`. The job is noninteractive and fails closed when either secret is absent.
It first reconciles durable candidate cleanup leases, then inspects the exact
production parent's branch list.

To cover a coordinator crash after Supabase creates a branch but before lease
registration commits, the scheduled job may adopt an unleased orphan only when
all of these checks pass: its name exactly matches
`genie-live-<8 lowercase hex>-<3 lowercase hex>`, its UUID and 20-character
preview ref are valid, its parent ref exactly equals production, both
`is_default` and `persistent` are explicitly false, and `created_at` is at least
six hours old by default. Nonmatching, young, default, persistent, cross-parent,
ambiguous, or partially colliding identities are never deleted. Orphan adoption
is itself durably and exclusively claimed before deletion, so concurrent or
restarted reapers remain idempotent.

For an authorized one-off invocation using the same trusted credentials:

```powershell
$env:SUPABASE_ACCESS_TOKEN = "<management-token>"
$env:SUPABASE_PROJECT_REF = "<exact-production-parent-ref>"
pnpm live-branch:reap
```

The forward-rollback drill applies three distinct forward SQL steps to an
isolated probe table: baseline, candidate change, and compensating change. A
fourth query asserts that the stable contract is restored and that all three
steps remain recorded in order. It does not call `db reset`, `migration down`,
or edit migration history.

The same drill runs in ordinary CI through:

```powershell
pnpm db:test:harness
```

On GitHub's Docker runner this uses the isolated local Supabase stack. There is
no managed-branch fallback in this command. When Docker is unavailable, managed
proof must run through the exact-identity trusted live controller above.

## Persistent-preview Realtime reconciliation

Use a long-lived **non-production preview project** whose Realtime replication
tenant is attached. Supply its three test credentials and ensure the skip flag
is absent:

```powershell
$env:GENIE_LIVE_SUPABASE_URL = "https://<preview-ref>.supabase.co"
$env:GENIE_LIVE_SUPABASE_ANON_KEY = "<preview-anon-key>"
$env:GENIE_LIVE_SUPABASE_SERVICE_ROLE_KEY = "<preview-service-role-key>"
Remove-Item Env:GENIE_LIVE_SKIP_REALTIME -ErrorAction SilentlyContinue
pnpm test:live:phase1:realtime
```

This gate creates isolated users/workspaces, proves owner delivery and outsider
silence on the published `domain_events` stream, disconnects both clients,
mutates while disconnected, refetches the authoritative Series projection,
reconnects, mutates again, and verifies that the reconciled state did not
resurrect the stale pre-disconnect projection. The harness leaves its uniquely
named test records in the preview project for audit; never point it at production.
